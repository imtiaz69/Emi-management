const mongoose = require("mongoose");
const Product = require("../models/Product");
const Loan = require("../models/Loan");
const EMISchedule = require("../models/EMISchedule");
const Transaction = require("../models/Transaction");
const Order = require("../models/Order");
const EMIApplication = require("../models/EMIApplication");
const BuyerProfile = require("../models/BuyerProfile");
const Shipment = require("../models/Shipment");
const User = require("../models/User");
const { calculateSchedule, roundMoney } = require("./emiService");
const { writeAudit } = require("./auditService");
const { convertReservationToSale, writeInventoryEntry } = require("./inventoryService");
const { ensureLoanAgreement } = require("./agreementService");
const { calculateBuyerRiskProfile } = require("./riskService");
const { createNotification, notifyLowStockProduct } = require("./notificationService");

function formatMoney(value) {
  return `BDT ${Number(value || 0).toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function notifyConfirmedTransaction(transaction) {
  if (!transaction) return;
  try {
    const isDownPayment = transaction.transactionType === "down_payment";
    const actionUrl = transaction.loanId ? `/loans/${transaction.loanId}` : `/orders/${transaction.orderId}`;
    await Promise.all([
      createNotification({
        userId: transaction.buyerId,
        loanId: transaction.loanId,
        title: isDownPayment ? "Down payment confirmed" : "EMI payment confirmed",
        messageType: isDownPayment ? "down_payment_confirmed" : "installment_payment_confirmed",
        message: `${formatMoney(transaction.amount)} was received successfully. Receipt: ${transaction.receiptNo}.`,
        category: "payment",
        severity: "success",
        actionUrl,
        metadata: {
          transactionId: transaction._id,
          receiptNo: transaction.receiptNo,
          amount: transaction.amount,
          method: transaction.method
        },
        dedupeKey: `transaction:${transaction._id}:buyer`
      }),
      createNotification({
        userId: transaction.sellerId,
        loanId: transaction.loanId,
        title: isDownPayment ? "Down payment received" : "EMI collection received",
        messageType: isDownPayment ? "down_payment_received" : "installment_payment_received",
        message: `${formatMoney(transaction.amount)} was confirmed${isDownPayment ? ". The EMI product is ready for fulfillment" : ""}.`,
        category: "payment",
        severity: "success",
        actionUrl: isDownPayment && transaction.orderId ? `/orders/${transaction.orderId}` : actionUrl,
        metadata: {
          buyerId: transaction.buyerId,
          transactionId: transaction._id,
          receiptNo: transaction.receiptNo,
          amount: transaction.amount,
          method: transaction.method
        },
        dedupeKey: `transaction:${transaction._id}:seller`
      })
    ]);
  } catch (error) {
    console.error("Unable to create payment notifications", error);
  }
}

function buildReceiptNo(prefix = "R") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function buildEmiOrderNo() {
  return `EMI-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

async function ensureMarketplaceDeliveryOrder(loan, { session, readyForDelivery } = {}) {
  if (loan.source !== "marketplace" || !loan.productId) return null;

  let order = null;
  if (loan.orderId) order = await Order.findById(loan.orderId).session(session || null);
  if (!order) order = await Order.findOne({ "items.loanId": loan._id }).session(session || null);

  if (order) {
    const linkedItem = order.items.find((item) => item.loanId?.toString() === loan._id.toString());
    loan.orderId = order._id;
    if (linkedItem) loan.orderItemId = linkedItem._id;
    await loan.save({ session });
    await Shipment.findOneAndUpdate(
      { orderId: order._id, sellerId: loan.sellerId },
      { $setOnInsert: { orderId: order._id, sellerId: loan.sellerId, status: "pending" } },
      { upsert: true, new: true, session }
    );
    return order;
  }

  const product = await Product.findById(loan.productId).session(session || null);
  const buyer = await User.findById(loan.buyerId).select("name phone").session(session || null);
  const buyerProfile = await BuyerProfile.findOne({ userId: loan.buyerId }).select("address").session(session || null);
  if (!product || !buyer) {
    const error = new Error("Cannot create the delivery order because its product or buyer no longer exists");
    error.status = 409;
    throw error;
  }

  const isReady = readyForDelivery ?? ["active", "closed"].includes(loan.status);
  order = await Order.create(
    [
      {
        orderNo: buildEmiOrderNo(),
        buyerId: loan.buyerId,
        sellerIds: [loan.sellerId],
        items: [
          {
            productId: product._id,
            sellerId: loan.sellerId,
            name: product.name,
            quantity: 1,
            unitPrice: Number(loan.principal),
            totalPrice: Number(loan.principal),
            financeMode: "emi",
            selectedColorName: loan.selectedColorName,
            selectedColorHex: loan.selectedColorHex,
            fulfillmentStatus: isReady ? "confirmed" : "pending",
            loanId: loan._id
          }
        ],
        subtotal: Number(loan.principal),
        discount: 0,
        deliveryCharge: 0,
        total: Number(loan.principal),
        paymentMode: "emi",
        paymentStatus: isReady ? "partial" : "unpaid",
        fulfillmentStatus: isReady ? "confirmed" : "pending",
        shippingAddress: {
          name: buyer.name,
          phone: buyer.phone || "",
          line1: buyerProfile?.address || "Address not provided - contact buyer",
          line2: "",
          city: "Not provided",
          area: "",
          postalCode: ""
        }
      }
    ],
    { session }
  ).then((documents) => documents[0]);

  loan.orderId = order._id;
  loan.orderItemId = order.items[0]._id;
  await loan.save({ session });
  await Shipment.create([{ orderId: order._id, sellerId: loan.sellerId, status: "pending" }], { session });
  await writeAudit(
    loan.buyerId,
    "legacyMarketplaceOrder.created",
    "Order",
    order._id,
    { loanId: loan._id, readyForDelivery: isReady },
    { session }
  );
  return order;
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
    }

    await writeAudit(actorId, requested ? "loan.requested" : "loan.created", "Loan", loan._id, { source: loan.source }, { session });
    await session.commitTransaction();
    const populatedLoan = await Loan.findById(loan._id).populate("buyerId", "name email phone").populate("productId", "name price");
    if (!requested) {
      await createNotification({
        userId: loan.buyerId,
        loanId: loan._id,
        title: "EMI loan activated",
        messageType: "emi_loan_activated",
        message: `Your EMI agreement for ${populatedLoan?.productId?.name || "the financed purchase"} is active.`,
        category: "loan",
        severity: "success",
        actionUrl: `/loans/${loan._id}`,
        metadata: { principal: loan.principal, tenureMonths: loan.tenureMonths },
        dedupeKey: `loan:${loan._id}:activated`
      }).catch((error) => console.error("Unable to create loan notification", error));
      if (payload.productId) {
        const product = await Product.findById(payload.productId);
        await notifyLowStockProduct(product).catch((error) => console.error("Unable to create stock notification", error));
      }
    }
    return populatedLoan;
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

    loan.status = "approved";
    loan.approvedAt = new Date();
    await loan.save({ session });
    const risk = await calculateBuyerRiskProfile({ buyerId: loan.buyerId, principal: loan.principal, downPayment: loan.downPayment, session });
    await EMIApplication.findOneAndUpdate(
      { loanId: loan._id },
      { status: "approved", riskScoreSnapshot: risk.riskScore, riskCategorySnapshot: risk.riskCategory },
      { session }
    );

    if (Number(loan.downPayment || 0) <= 0) {
      await activateLoanRecords(loan, actorId, { session });
    }

    await writeAudit(
      actorId,
      Number(loan.downPayment || 0) > 0 ? "loan.approved.awaiting_down_payment" : "loan.approved.activated",
      "Loan",
      loan._id,
      { downPayment: loan.downPayment },
      { session }
    );
    await session.commitTransaction();
    return Loan.findById(loan._id).populate("buyerId", "name email phone").populate("productId", "name price");
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}

async function activateLoanRecords(loan, actorId, { session } = {}) {
  const existingScheduleCount = await EMISchedule.countDocuments({ loanId: loan._id }).session(session || null);
  if (existingScheduleCount > 0 && ["active", "closed"].includes(loan.status)) return loan;

  const product = loan.productId ? await Product.findById(loan.productId).session(session || null) : null;
  if (product) {
    if (loan.orderId) {
      const order = await Order.findById(loan.orderId).session(session || null);
      const orderItem = order?.items.id(loan.orderItemId);
      if (!order || !orderItem) {
        const error = new Error("The order item linked to this EMI loan was not found");
        error.status = 409;
        throw error;
      }
      if (orderItem.fulfillmentStatus === "cancelled") {
        const error = new Error("A cancelled EMI order cannot be activated");
        error.status = 409;
        throw error;
      }

      await convertReservationToSale(product, orderItem.quantity, "Loan", loan._id, {
        session,
        note: `EMI down payment confirmed for order ${order.orderNo}`
      });
      orderItem.fulfillmentStatus = "confirmed";
      orderItem.loanId = loan._id;
      order.paymentStatus = "partial";
      if (order.items.every((item) => ["confirmed", "processing", "shipped", "delivered"].includes(item.fulfillmentStatus))) {
        order.fulfillmentStatus = "confirmed";
      }
      await order.save({ session });
    } else {
      if (product.stock < 1) {
        const error = new Error("Product is out of stock");
        error.status = 409;
        throw error;
      }
      product.stock -= 1;
      await product.save({ session });
      await writeInventoryEntry(
        {
          product,
          type: "sale",
          quantity: -1,
          referenceType: "Loan",
          referenceId: loan._id,
          note: "Marketplace EMI activated after confirmed down payment"
        },
        { session }
      );
      await ensureMarketplaceDeliveryOrder(loan, { session, readyForDelivery: true });
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
  loan.activatedAt = new Date();
  await loan.save({ session });

  if (existingScheduleCount === 0) {
    await EMISchedule.insertMany(
      result.schedule.map((row) => ({
        ...row,
        loanId: loan._id,
        buyerId: loan.buyerId,
        sellerId: loan.sellerId
      })),
      { session }
    );
  }
  await EMIApplication.findOneAndUpdate({ loanId: loan._id }, { status: "converted_to_loan" }, { session });
  await ensureLoanAgreement(loan, { session });
  await writeAudit(actorId, "loan.activated", "Loan", loan._id, { orderId: loan.orderId }, { session });
  return loan;
}

async function activateApprovedLoanAfterDownPayment(
  { loanId, buyerId, amount, method = "stripe", gatewayRef, notes = "EMI down payment" },
  actorId
) {
  if (gatewayRef) {
    const existing = await Transaction.findOne({ gatewayRef });
    if (existing) {
      await notifyConfirmedTransaction(existing);
      return existing;
    }
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const loan = await Loan.findOne({ _id: loanId, buyerId }).session(session);
    if (!loan) {
      const error = new Error("Approved EMI loan not found for this buyer");
      error.status = 404;
      throw error;
    }
    if (loan.status !== "approved") {
      const existing = gatewayRef ? await Transaction.findOne({ gatewayRef }).session(session) : null;
      if (existing) {
        await session.commitTransaction();
        return existing;
      }
      const error = new Error("This EMI loan is not waiting for a down payment");
      error.status = 409;
      throw error;
    }

    const requiredAmount = roundMoney(Number(loan.downPayment || 0));
    const paidAmount = roundMoney(Number(amount || 0));
    if (requiredAmount < 1 || paidAmount !== requiredAmount) {
      const error = new Error(`The required down payment is BDT ${Math.round(requiredAmount)}`);
      error.status = 400;
      throw error;
    }

    const transaction = await Transaction.create(
      [
        {
          loanId: loan._id,
          orderId: loan.orderId,
          transactionType: "down_payment",
          buyerId: loan.buyerId,
          sellerId: loan.sellerId,
          amount: paidAmount,
          method,
          paymentDate: new Date(),
          gatewayRef,
          receiptNo: buildReceiptNo("DP"),
          recordedBy: actorId,
          notes,
          status: "confirmed"
        }
      ],
      { session }
    ).then((docs) => docs[0]);

    await activateLoanRecords(loan, actorId, { session });
    await writeAudit(
      actorId,
      "downPayment.confirmed",
      "Transaction",
      transaction._id,
      { loanId: loan._id, amount: paidAmount, method },
      { session }
    );
    await session.commitTransaction();
    await notifyConfirmedTransaction(transaction);
    if (loan.productId) {
      const product = await Product.findById(loan.productId);
      await notifyLowStockProduct(product).catch((error) => console.error("Unable to create stock notification", error));
    }
    return transaction;
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
    const allocations = [];
    for (const schedule of allocationSchedules) {
      if (remaining <= 0) break;
      const due = getScheduleBalance(schedule);
      const applied = Math.min(remaining, due);
      schedule.amountPaid = roundMoney(schedule.amountPaid + applied);
      schedule.status = schedule.amountPaid >= roundMoney(schedule.amountDue + schedule.lateFee) ? "paid" : "partial";
      if (schedule.status === "paid") schedule.paidAt = paymentDate || new Date();
      await schedule.save({ session });
      if (applied > 0) {
        allocations.push({
          scheduleId: schedule._id,
          installmentNo: schedule.installmentNo,
          amount: applied
        });
      }
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
          allocations,
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
    await notifyConfirmedTransaction(transaction);
    return transaction;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}

module.exports = {
  activateApprovedLoanAfterDownPayment,
  activateLoanRecords,
  buildReceiptNo,
  createApplicationForLoan,
  createLoanWithSchedule,
  approveLoanRequest,
  ensureMarketplaceDeliveryOrder,
  getPaymentAllocationPreview,
  recordDownPayment,
  recordPayment,
  selectPaymentAllocationSchedules,
  notifyConfirmedTransaction
};
