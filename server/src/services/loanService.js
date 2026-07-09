const mongoose = require("mongoose");
const Product = require("../models/Product");
const Loan = require("../models/Loan");
const EMISchedule = require("../models/EMISchedule");
const Transaction = require("../models/Transaction");
const Order = require("../models/Order");
const { calculateSchedule, roundMoney } = require("./emiService");
const { writeAudit } = require("./auditService");
const { convertReservationToSale } = require("./inventoryService");

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

    await EMISchedule.insertMany(
      result.schedule.map((row) => ({
        ...row,
        loanId: loan._id,
        buyerId: loan.buyerId,
        sellerId: loan.sellerId
      })),
      { session }
    );

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
  { loanId, amount, method, paymentDate, scheduleId, gatewayRef, notes },
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

    const schedulesQuery = scheduleId ? { _id: scheduleId, loanId } : { loanId, status: { $in: ["pending", "partial", "overdue"] } };
    const schedules = await EMISchedule.find(schedulesQuery).sort({ dueDate: 1 }).session(session);
    if (!schedules.length) throw new Error("No payable schedule found");

    let lastScheduleId = schedules[0]._id;
    for (const schedule of schedules) {
      if (remaining <= 0) break;
      const due = roundMoney(schedule.amountDue + schedule.lateFee - schedule.amountPaid);
      const applied = Math.min(remaining, due);
      schedule.amountPaid = roundMoney(schedule.amountPaid + applied);
      schedule.status = schedule.amountPaid >= roundMoney(schedule.amountDue + schedule.lateFee) ? "paid" : "partial";
      if (schedule.status === "paid") schedule.paidAt = paymentDate || new Date();
      await schedule.save({ session });
      remaining = roundMoney(remaining - applied);
      lastScheduleId = schedule._id;
    }

    const receiptNo = `R-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const transaction = await Transaction.create(
      [
        {
          loanId,
          scheduleId: scheduleId || lastScheduleId,
          buyerId: loan.buyerId,
          sellerId: loan.sellerId,
          amount,
          method,
          paymentDate: paymentDate || new Date(),
          gatewayRef,
          receiptNo,
          recordedBy: actorId,
          notes
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

module.exports = { createLoanWithSchedule, approveLoanRequest, recordPayment };
