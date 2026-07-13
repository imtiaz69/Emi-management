const mongoose = require("mongoose");
const Product = require("../models/Product");
const Loan = require("../models/Loan");
const EMISchedule = require("../models/EMISchedule");
const Transaction = require("../models/Transaction");
const Order = require("../models/Order");
const EMIApplication = require("../models/EMIApplication");
const { calculateSchedule, roundMoney } = require("./emiService");
const { writeAudit } = require("./auditService");
const { convertReservationToSale } = require("./inventoryService");
const { ensureLoanAgreement } = require("./agreementService");
const { calculateBuyerRiskProfile } = require("./riskService");

function buildReceiptNo(prefix = "R") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function getScheduleBalance(schedule) {
  return Math.max(roundMoney(Number(schedule.amountDue || 0) + Number(schedule.lateFee || 0) - Number(schedule.amountPaid || 0)), 0);
}

function normalizeInstallmentCount(installmentCount) {
  const count = Number(installmentCount === undefined || installmentCount === null || installmentCount === "" ? 1 : installmentCount);
  if (!Number.isInteger(count) || count < 1 || count > 60) {
    const error = new Error("Installment count must be between 1 and 60");
    error.status = 400;
    throw error;
  }
  return count;
}

function selectPaymentAllocationSchedules(schedules, { scheduleId, allocationMode = "advance", installmentCount } = {}) {
  if (scheduleId) return schedules;
  if (allocationMode === "next_due") return schedules.slice(0, 1);
  if (allocationMode === "next_n") return schedules.slice(0, normalizeInstallmentCount(installmentCount));
  return schedules;
}

async function getPaymentAllocationPreview({ loanId, scheduleId, allocationMode = "advance", installmentCount }, { session } = {}) {
  const payableStatuses = ["pending", "partial", "overdue"];
  const schedulesQuery = scheduleId ? { _id: scheduleId, loanId } : { loanId, status: { $in: payableStatuses } };
  if (!scheduleId && allocationMode === "overdue") schedulesQuery.status = "overdue";

  const query = EMISchedule.find(schedulesQuery).sort({ dueDate: 1 });
  if (session) query.session(session);
  const schedules = await query;
  if (!schedules.length) {
    const error = new Error("No payable schedule found");
    error.status = 400;
    throw error;
  }

  const allocationSchedules = selectPaymentAllocationSchedules(schedules, { scheduleId, allocationMode, installmentCount });
  if (!allocationSchedules.length) {
    const error = new Error("No payable schedule found for the selected payment option");
    error.status = 400;
    throw error;
  }

  return {
    schedules: allocationSchedules,
    outstanding: allocationSchedules.reduce((sum, schedule) => sum + getScheduleBalance(schedule), 0)
  };
}

async function createApplicationForLoan(loan, session) {
  const risk = await calculateBuyerRiskProfile({
    buyerId: loan.buyerId,
    principal: loan.principal,
    downPayment: loan.downPayment,
    session
  });
  const kycPending = risk.inputs?.kycUploaded ? "under_review" : "kyc_pending";
  const [application] = await EMIApplication.create(
    [
      {
        buyerId: loan.buyerId,
        sellerId: loan.sellerId,
        orderId: loan.orderId,
        orderItemId: loan.orderItemId,
        productId: loan.productId,
        loanId: loan._id,
        requestedPrincipal: loan.principal,
        downPayment: loan.downPayment,
        tenureMonths: loan.tenureMonths,
        interestRate: loan.interestRate,
        interestType: loan.interestType,
        status: kycPending,
        riskScoreSnapshot: risk.riskScore,
        riskCategorySnapshot: risk.riskCategory
      }
    ],
    { session }
  );
  return application;
}

async function recordDownPayment({ loan, orderId, amount, method = "cash", actorId, session, notes = "Down payment" }) {
  if (!Number(amount || 0)) return null;
  const [transaction] = await Transaction.create(
    [
      {
        loanId: loan._id,
        orderId,
        transactionType: "down_payment",
        buyerId: loan.buyerId,
        sellerId: loan.sellerId,
        amount,
        method,
        paymentDate: new Date(),
        receiptNo: buildReceiptNo("DP"),
        recordedBy: actorId,
        notes,
        status: "confirmed"
      }
    ],
    { session }
  );
  return transaction;
}

async function createLoanWithSchedule(payload, actorId, { requested = false } = {}) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    let principal = Number(payload.principal);
    if (payload.productId) {
      const product = await Product.findById(payload.productId).session(session);
      if (!product || product.status !== "active") throw new Error("Product not available");
      if (product.stock < 1 && !requested) throw new Error("Product is out of stock");
      principal = Number(payload.principal || product.price);
      if (!requested) {
        product.stock -= 1;
        await product.save({ session });
      }
    }

    const result = calculateSchedule({
      principal,
      downPayment: Number(payload.downPayment || 0),
      interestRate: Number(payload.interestRate || 0),
      interestType: payload.interestType || "flat",
      tenureMonths: Number(payload.tenureMonths),
      startDate: payload.startDate || new Date()
    });

    const loan = await Loan.create(
      [
        {
          sellerId: payload.sellerId,
          buyerId: payload.buyerId,
          productId: payload.productId || undefined,
          selectedColorName: payload.selectedColorName,
          selectedColorHex: payload.selectedColorHex,
          source: payload.source || "offline",
          principal,
          downPayment: Number(payload.downPayment || 0),
          interestRate: Number(payload.interestRate || 0),
          interestType: payload.interestType || "flat",
          tenureMonths: Number(payload.tenureMonths),
          lateFeePolicy: payload.lateFeePolicy || { type: "none", value: 0 },
          totalPayable: result.totalPayable,
          status: requested ? "requested" : "active",
          approvedAt: requested ? undefined : new Date(),
          activatedAt: requested ? undefined : new Date()
        }
      ],
      { session }
    ).then((docs) => docs[0]);

    if (!requested) {
      await EMISchedule.insertMany(
        result.schedule.map((row) => ({
          ...row,
          loanId: loan._id,
          buyerId: payload.buyerId,
          sellerId: payload.sellerId
        })),
        { session }
      );
      await recordDownPayment({
        loan,
        amount: Number(payload.downPayment || 0),
        method: payload.downPaymentMethod || "cash",
        actorId,
        session,
        notes: "Offline loan down payment"
      });
      await ensureLoanAgreement(loan, { session });
    } else {
      await createApplicationForLoan(loan, session);
      await recordDownPayment({
        loan,
        amount: Number(payload.downPayment || 0),
        method: payload.downPaymentMethod || "mock_gateway",
        actorId,
        session,
        notes: "Online EMI request down payment"
      });
    }

    await writeAudit(actorId, requested ? "loan.requested" : "loan.created", "Loan", loan._id, { source: loan.source }, { session });
    await session.commitTransaction();
    return Loan.findById(loan._id).populate("buyerId", "name email phone").populate("productId", "name price");
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}

async function approveLoanRequest(loanId, sellerId, actorId) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const loan = await Loan.findOne({ _id: loanId, sellerId, status: "requested" }).session(session);
    if (!loan) throw new Error("Pending loan request not found");

    const product = loan.productId ? await Product.findById(loan.productId).session(session) : null;
    if (product) {
      if (loan.orderId) {
        const order = await Order.findById(loan.orderId).session(session);
        const orderItem = order?.items.id(loan.orderItemId);
        if (orderItem) {
          await convertReservationToSale(product, orderItem.quantity, "Loan", loan._id, { session, note: `EMI approved for order ${order.orderNo}` });
          orderItem.fulfillmentStatus = "confirmed";
          orderItem.loanId = loan._id;
          order.paymentStatus = "partial";
          if (order.fulfillmentStatus === "pending") order.fulfillmentStatus = "confirmed";
          await order.save({ session });
        }
      } else {
        if (product.stock < 1) throw new Error("Product is out of stock");
        product.stock -= 1;
        await product.save({ session });
      }
    }

    const result = calculateSchedule({
      principal: loan.principal,
      downPayment: loan.downPayment,
      interestRate: loan.interestRate,
      interestType: loan.interestType,
      tenureMonths: loan.tenureMonths,
      startDate: new Date()
    });

    loan.status = "active";
    loan.approvedAt = new Date();
    loan.activatedAt = new Date();
    await loan.save({ session });
    const risk = await calculateBuyerRiskProfile({ buyerId: loan.buyerId, principal: loan.principal, downPayment: loan.downPayment, session });
    await EMIApplication.findOneAndUpdate(
      { loanId: loan._id },
      { status: "converted_to_loan", riskScoreSnapshot: risk.riskScore, riskCategorySnapshot: risk.riskCategory },
      { session }
    );

    await EMISchedule.insertMany(
      result.schedule.map((row) => ({
        ...row,
        loanId: loan._id,
        buyerId: loan.buyerId,
        sellerId: loan.sellerId
      })),
      { session }
    );
    await ensureLoanAgreement(loan, { session });

    await writeAudit(actorId, "loan.approved", "Loan", loan._id, {}, { session });
    await session.commitTransaction();
    return Loan.findById(loan._id).populate("buyerId", "name email phone").populate("productId", "name price");
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}

async function recordPayment(
  { loanId, amount, method, paymentDate, scheduleId, gatewayRef, notes, allocationMode = "advance", installmentCount },
  actorId,
  { requireSellerOwnership = false, requireBuyerOwnership = false } = {}
) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const loan = await Loan.findById(loanId).session(session);
    if (!loan) throw new Error("Loan not found");
    if (requireSellerOwnership && loan.sellerId.toString() !== actorId.toString()) {
      const error = new Error("You can only record payments for loans from your shop");
      error.status = 403;
      throw error;
    }
    if (requireBuyerOwnership && loan.buyerId.toString() !== actorId.toString()) {
      const error = new Error("You can only pay your own loans");
      error.status = 403;
      throw error;
    }
    let remaining = Number(amount);
    if (!Number.isFinite(remaining) || remaining <= 0) {
      const error = new Error("Payment amount must be greater than zero");
      error.status = 400;
      throw error;
    }

    const { schedules: allocationSchedules, outstanding } = await getPaymentAllocationPreview(
      { loanId, scheduleId, allocationMode, installmentCount },
      { session }
    );
    if (remaining > outstanding) {
      const error = new Error(`Payment cannot exceed selected outstanding amount BDT ${Math.round(outstanding)}`);
      error.status = 400;
      throw error;
    }

    let lastScheduleId = allocationSchedules[0]._id;
    for (const schedule of allocationSchedules) {
      if (remaining <= 0) break;
      const due = getScheduleBalance(schedule);
      const applied = Math.min(remaining, due);
      schedule.amountPaid = roundMoney(schedule.amountPaid + applied);
      schedule.status = schedule.amountPaid >= roundMoney(schedule.amountDue + schedule.lateFee) ? "paid" : "partial";
      if (schedule.status === "paid") schedule.paidAt = paymentDate || new Date();
      await schedule.save({ session });
      remaining = roundMoney(remaining - applied);
      lastScheduleId = schedule._id;
    }

    const receiptNo = buildReceiptNo("R");
    const transaction = await Transaction.create(
      [
        {
          loanId,
          scheduleId: scheduleId || lastScheduleId,
          transactionType: "installment",
          buyerId: loan.buyerId,
          sellerId: loan.sellerId,
          amount,
          method,
          paymentDate: paymentDate || new Date(),
          gatewayRef,
          receiptNo,
          recordedBy: actorId,
          notes,
          status: "confirmed"
        }
      ],
      { session }
    ).then((docs) => docs[0]);

    const openCount = await EMISchedule.countDocuments({ loanId, status: { $ne: "paid" } }).session(session);
    if (openCount === 0) {
      loan.status = "closed";
      await loan.save({ session });
    }

    await writeAudit(actorId, "payment.recorded", "Transaction", transaction._id, { loanId, amount, method }, { session });
    await session.commitTransaction();
    return transaction;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}

module.exports = {
  buildReceiptNo,
  createApplicationForLoan,
  createLoanWithSchedule,
  approveLoanRequest,
  getPaymentAllocationPreview,
  recordDownPayment,
  recordPayment,
  selectPaymentAllocationSchedules
};
