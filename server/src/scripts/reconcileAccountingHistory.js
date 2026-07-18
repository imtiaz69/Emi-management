require("dotenv").config();
const mongoose = require("mongoose");
const EMISchedule = require("../models/EMISchedule");
const Loan = require("../models/Loan");
const Order = require("../models/Order");
const Transaction = require("../models/Transaction");
const { buildReceiptNo } = require("../services/loanService");
const { sellerOrderFinancials } = require("../services/sellerAccountingService");

function appendNote(current, note) {
  return [current, note].filter(Boolean).join(" | ");
}

async function reverseLegacyScheduleAllocation(loanId, amount, session) {
  let remaining = Number(amount || 0);
  const schedules = await EMISchedule.find({ loanId, amountPaid: { $gt: 0 } }).sort({ installmentNo: 1 }).session(session);
  for (const schedule of schedules) {
    if (remaining <= 0) break;
    const reversal = Math.min(Number(schedule.amountPaid || 0), remaining);
    schedule.amountPaid = Math.max(Number(schedule.amountPaid || 0) - reversal, 0);
    remaining -= reversal;
    const balance = Number(schedule.amountDue || 0) + Number(schedule.lateFee || 0) - Number(schedule.amountPaid || 0);
    if (balance <= 0) {
      schedule.status = "paid";
    } else if (schedule.dueDate < new Date()) {
      schedule.status = "overdue";
      schedule.paidAt = undefined;
    } else {
      schedule.status = schedule.amountPaid > 0 ? "partial" : "pending";
      schedule.paidAt = undefined;
    }
    await schedule.save({ session });
  }
}

async function buildReconciliationPlan() {
  const invalidDownPayments = [];
  const confirmedDownPayments = await Transaction.find({
    transactionType: "down_payment",
    status: "confirmed",
    loanId: { $exists: true, $ne: null }
  })
    .populate("loanId", "status")
    .lean();
  for (const transaction of confirmedDownPayments) {
    if (transaction.loanId && ["requested", "approved", "rejected"].includes(transaction.loanId.status)) {
      invalidDownPayments.push(transaction._id.toString());
    }
  }
  const normalizeLegacyMockMethods = (
    await Transaction.find({
      method: "mock_gateway",
      status: "confirmed",
      _id: { $nin: invalidDownPayments }
    })
      .select("_id")
      .lean()
  ).map((transaction) => transaction._id.toString());

  const missingTransactions = await Transaction.find({
    $or: [
      { transactionType: { $exists: false } },
      { transactionType: null },
      { status: { $exists: false } },
      { status: null }
    ]
  })
    .sort({ paymentDate: 1 })
    .lean();
  const activeLoans = await Loan.find({ status: { $in: ["active", "closed", "defaulted"] } }).lean();
  const missingByLoan = new Map();
  for (const transaction of missingTransactions) {
    const loanId = transaction.loanId?.toString();
    if (!loanId) continue;
    if (!missingByLoan.has(loanId)) missingByLoan.set(loanId, []);
    missingByLoan.get(loanId).push(transaction);
  }

  const reclassifyAsDownPayment = [];
  const reclassifyAsInstallment = [];
  const createLoanDownPayments = [];
  for (const loan of activeLoans) {
    const loanId = loan._id.toString();
    const missingRows = missingByLoan.get(loanId) || [];
    const existingDownPayment = await Transaction.exists({
      loanId: loan._id,
      transactionType: "down_payment",
      status: "confirmed",
      _id: { $nin: invalidDownPayments }
    });
    let downPaymentCandidate = null;
    if (!existingDownPayment && loan.source === "marketplace" && Number(loan.downPayment || 0) > 0) {
      downPaymentCandidate = missingRows.find(
        (transaction) => Math.round(Number(transaction.amount || 0)) === Math.round(Number(loan.downPayment || 0))
      );
      if (downPaymentCandidate) {
        reclassifyAsDownPayment.push({
          transactionId: downPaymentCandidate._id.toString(),
          loanId,
          amount: Number(downPaymentCandidate.amount)
        });
      }
    }
    for (const transaction of missingRows) {
      if (downPaymentCandidate && transaction._id.toString() === downPaymentCandidate._id.toString()) continue;
      reclassifyAsInstallment.push(transaction._id.toString());
    }
    if (!existingDownPayment && !downPaymentCandidate && loan.source === "offline" && Number(loan.downPayment || 0) > 0) {
      createLoanDownPayments.push(loanId);
    }
  }

  const paidCashOrders = await Order.find({
    paymentStatus: "paid",
    fulfillmentStatus: { $nin: ["cancelled", "returned"] },
    "items.financeMode": "cash"
  }).lean();
  const createCashPayments = [];
  for (const order of paidCashOrders) {
    const sellerIds = [...new Set(order.items.filter((item) => item.financeMode === "cash").map((item) => item.sellerId.toString()))];
    for (const sellerId of sellerIds) {
      const exists = await Transaction.exists({
        orderId: order._id,
        sellerId,
        transactionType: "order_payment",
        status: "confirmed"
      });
      if (!exists) createCashPayments.push({ orderId: order._id.toString(), sellerId });
    }
  }

  return {
    invalidDownPayments,
    normalizeLegacyMockMethods,
    reclassifyAsDownPayment,
    reclassifyAsInstallment,
    createLoanDownPayments,
    createCashPayments
  };
}

async function reconcileAccountingHistory({ dryRun = false } = {}) {
  const plan = await buildReconciliationPlan();
  if (dryRun) return plan;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const transactionId of plan.invalidDownPayments) {
        const transaction = await Transaction.findById(transactionId).session(session);
        if (!transaction) continue;
        transaction.status = "failed";
        transaction.notes = appendNote(transaction.notes, "Invalid historical mock payment excluded during accounting reconciliation");
        await transaction.save({ session });
      }

      for (const transactionId of plan.normalizeLegacyMockMethods) {
        const transaction = await Transaction.findById(transactionId).session(session);
        if (!transaction) continue;
        transaction.method = "cash";
        transaction.notes = appendNote(transaction.notes, "Historical demo method normalized to manual cash");
        await transaction.save({ session });
      }

      for (const entry of plan.reclassifyAsDownPayment) {
        const transaction = await Transaction.findById(entry.transactionId).session(session);
        if (!transaction) continue;
        transaction.transactionType = "down_payment";
        transaction.status = "confirmed";
        transaction.notes = appendNote(transaction.notes, "Historical payment reclassified as EMI down payment");
        await transaction.save({ session });
        await reverseLegacyScheduleAllocation(entry.loanId, entry.amount, session);
      }

      for (const transactionId of plan.reclassifyAsInstallment) {
        const transaction = await Transaction.findById(transactionId).session(session);
        if (!transaction) continue;
        transaction.transactionType = "installment";
        transaction.status = "confirmed";
        transaction.notes = appendNote(transaction.notes, "Historical installment metadata reconciled");
        await transaction.save({ session });
      }

      for (const loanId of plan.createLoanDownPayments) {
        const loan = await Loan.findById(loanId).session(session);
        if (!loan) continue;
        await Transaction.create(
          [
            {
              loanId: loan._id,
              orderId: loan.orderId,
              transactionType: "down_payment",
              buyerId: loan.buyerId,
              sellerId: loan.sellerId,
              amount: loan.downPayment,
              method: "cash",
              paymentDate: loan.activatedAt || loan.createdAt,
              receiptNo: buildReceiptNo("HIST-DP"),
              recordedBy: loan.sellerId,
              notes: "Historical offline down payment reconciliation",
              status: "confirmed"
            }
          ],
          { session }
        );
      }

      for (const entry of plan.createCashPayments) {
        const order = await Order.findById(entry.orderId).session(session);
        if (!order) continue;
        const financials = sellerOrderFinancials(order, entry.sellerId);
        if (!financials.hasCashItems || financials.checkoutValue <= 0) continue;
        await Transaction.create(
          [
            {
              orderId: order._id,
              transactionType: "order_payment",
              buyerId: order.buyerId,
              sellerId: entry.sellerId,
              amount: financials.checkoutValue,
              method: "cash",
              paymentDate: order.updatedAt || order.createdAt,
              receiptNo: buildReceiptNo("HIST-ORD"),
              recordedBy: order.buyerId,
              notes: "Historical paid cash order reconciliation",
              status: "confirmed"
            }
          ],
          { session }
        );
      }
    });
  } finally {
    await session.endSession();
  }
  return { ...plan, completed: true };
}

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
  await mongoose.connect(process.env.MONGO_URI);
  const result = await reconcileAccountingHistory({ dryRun: process.argv.includes("--dry-run") });
  console.log(JSON.stringify(result, null, 2));
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error(error.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}

module.exports = { buildReconciliationPlan, reconcileAccountingHistory, reverseLegacyScheduleAllocation };
