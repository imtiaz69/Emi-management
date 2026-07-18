const cron = require("node-cron");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
const EMISchedule = require("../models/EMISchedule");
const BuyerProfile = require("../models/BuyerProfile");
const Product = require("../models/Product");
const User = require("../models/User");
const { calculateLateFee, calculateRiskScore, riskCategoryFromDays, roundMoney } = require("../services/emiService");
const { createNotification, notifyLowStockProduct } = require("../services/notificationService");

dayjs.extend(utc);
dayjs.extend(timezone);

const UPCOMING_REMINDER_DAYS = [7, 3, 2, 1, 0];
const OVERDUE_REMINDER_DAYS = [1, 3, 7, 15, 30];
const APP_TIMEZONE = process.env.APP_TIMEZONE || "Asia/Dhaka";

function calendarDay(value) {
  return dayjs(value).tz(APP_TIMEZONE).startOf("day");
}

function money(value) {
  return `BDT ${Number(value || 0).toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function scheduleBalance(schedule) {
  return roundMoney(Math.max(0, Number(schedule.amountDue || 0) + Number(schedule.lateFee || 0) - Number(schedule.amountPaid || 0)));
}

async function notifyUpcomingInstallment({ schedule, loan, daysUntilDue }) {
  const dueLabel = daysUntilDue === 0 ? "due today" : `due in ${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"}`;
  const messageType = daysUntilDue === 0 ? "emi_due_today" : `emi_due_${daysUntilDue}_days`;
  return createNotification({
    userId: schedule.buyerId,
    loanId: loan._id,
    title: daysUntilDue === 0 ? "EMI payment due today" : "Upcoming EMI payment",
    messageType,
    message: `Installment #${schedule.installmentNo} is ${dueLabel}. Amount to pay: ${money(scheduleBalance(schedule))}.`,
    category: "loan",
    severity: daysUntilDue <= 1 ? "critical" : daysUntilDue <= 3 ? "warning" : "info",
    actionUrl: `/loans/${loan._id}`,
    metadata: {
      scheduleId: schedule._id,
      installmentNo: schedule.installmentNo,
      daysUntilDue,
      dueDate: schedule.dueDate,
      amount: scheduleBalance(schedule)
    },
    dedupeKey: `emi-schedule:${schedule._id}:due:${daysUntilDue}`
  });
}

async function notifyOverdueInstallment({ schedule, loan, daysOverdue }) {
  const amount = scheduleBalance(schedule);
  await Promise.all([
    createNotification({
      userId: schedule.buyerId,
      loanId: loan._id,
      title: "EMI payment overdue",
      messageType: "emi_overdue",
      message: `Installment #${schedule.installmentNo} is ${daysOverdue} day${daysOverdue === 1 ? "" : "s"} overdue. Outstanding: ${money(amount)}.`,
      category: "loan",
      severity: "critical",
      actionUrl: `/loans/${loan._id}`,
      metadata: { scheduleId: schedule._id, installmentNo: schedule.installmentNo, daysOverdue, amount },
      dedupeKey: `emi-schedule:${schedule._id}:overdue:${daysOverdue}`
    }),
    createNotification({
      userId: schedule.sellerId || loan.sellerId,
      loanId: loan._id,
      title: "Customer installment overdue",
      messageType: "customer_emi_overdue",
      message: `Installment #${schedule.installmentNo} is ${daysOverdue} day${daysOverdue === 1 ? "" : "s"} overdue. Outstanding: ${money(amount)}.`,
      category: "risk",
      severity: "critical",
      actionUrl: `/loans/${loan._id}`,
      metadata: {
        buyerId: schedule.buyerId,
        scheduleId: schedule._id,
        installmentNo: schedule.installmentNo,
        daysOverdue,
        amount
      },
      dedupeKey: `emi-schedule:${schedule._id}:seller-overdue:${daysOverdue}`
    })
  ]);
}

async function updateBuyerRisks(affectedBuyerIds, asOf) {
  let highRiskAlerts = 0;
  for (const buyerId of affectedBuyerIds) {
    const rows = await EMISchedule.find({ buyerId, status: "overdue" });
    const overdueAmount = rows.reduce((sum, row) => sum + scheduleBalance(row), 0);
    const totalDaysOverdue = rows.reduce(
      (sum, row) => sum + Math.max(0, calendarDay(asOf).diff(calendarDay(row.dueDate), "day")),
      0
    );
    const totalEmis = await EMISchedule.countDocuments({ buyerId });
    const averageEmi = rows.length ? rows.reduce((sum, row) => sum + Number(row.amountDue || 0), 0) / rows.length : 0;
    const maxDays = rows.reduce(
      (max, row) => Math.max(max, calendarDay(asOf).diff(calendarDay(row.dueDate), "day")),
      0
    );
    const riskScore = calculateRiskScore({ overdueAmount, totalDaysOverdue, totalEmis, averageEmi });
    const riskCategory = riskCategoryFromDays(maxDays);
    const profile = await BuyerProfile.findOneAndUpdate(
      { userId: buyerId },
      { riskScore, riskCategory },
      { new: true }
    );

    if (!profile || !["high", "critical"].includes(riskCategory)) continue;
    const [buyer, sellerIds] = await Promise.all([
      User.findById(buyerId).select("name"),
      EMISchedule.distinct("sellerId", { buyerId, status: "overdue" })
    ]);
    const dateKey = calendarDay(asOf).format("YYYY-MM-DD");
    await Promise.all(
      sellerIds.map((sellerId) =>
        createNotification({
          userId: sellerId,
          title: `${riskCategory === "critical" ? "Critical" : "High"}-risk customer alert`,
          messageType: "high_risk_customer",
          message: `${buyer?.name || "A customer"} is now ${riskCategory} risk with ${money(overdueAmount)} overdue.`,
          category: "risk",
          severity: "critical",
          actionUrl: `/buyers/${buyerId}`,
          metadata: { buyerId, riskScore, riskCategory, overdueAmount, maxDaysOverdue: maxDays },
          dedupeKey: `buyer-risk:${buyerId}:${riskCategory}:${dateKey}`
        })
      )
    );
    highRiskAlerts += sellerIds.length;
  }
  return highRiskAlerts;
}

async function runLowStockCheck(asOf = new Date()) {
  const products = await Product.find({
    status: "active",
    $expr: { $lte: ["$stock", "$lowStockThreshold"] }
  }).select("sellerId name sku stock lowStockThreshold status");

  await Promise.all(
    products.map((product) => notifyLowStockProduct(product, asOf))
  );
  return products.length;
}

async function runOverdueCheck(options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const today = calendarDay(now);
  const schedules = await EMISchedule.find({
    status: { $in: ["pending", "partial", "overdue"] }
  }).populate("loanId");

  const affectedBuyers = new Set();
  let upcomingAlerts = 0;
  let overdueAlerts = 0;

  for (const schedule of schedules) {
    const loan = schedule.loanId;
    if (!loan || !["active", "defaulted"].includes(loan.status)) continue;

    const dueDay = calendarDay(schedule.dueDate);
    const daysUntilDue = dueDay.diff(today, "day");
    const daysOverdue = today.diff(dueDay, "day");

    if (UPCOMING_REMINDER_DAYS.includes(daysUntilDue)) {
      await notifyUpcomingInstallment({ schedule, loan, daysUntilDue });
      upcomingAlerts += 1;
    }

    if (daysOverdue > 0) {
      schedule.status = "overdue";
      schedule.lateFee = calculateLateFee(schedule, loan.lateFeePolicy, now);
      await schedule.save();
      affectedBuyers.add(schedule.buyerId.toString());

      if (OVERDUE_REMINDER_DAYS.includes(daysOverdue)) {
        await notifyOverdueInstallment({ schedule, loan, daysOverdue });
        overdueAlerts += 1;
      }
    }
  }

  const [highRiskAlerts, lowStockAlerts] = await Promise.all([
    updateBuyerRisks(affectedBuyers, now),
    runLowStockCheck(now)
  ]);

  return {
    checked: schedules.length,
    upcomingAlerts,
    overdueAlerts,
    buyersUpdated: affectedBuyers.size,
    highRiskAlerts,
    lowStockAlerts
  };
}

function startOverdueJob() {
  return cron.schedule("0 9 * * *", runOverdueCheck, { timezone: APP_TIMEZONE });
}

module.exports = {
  OVERDUE_REMINDER_DAYS,
  UPCOMING_REMINDER_DAYS,
  runLowStockCheck,
  runOverdueCheck,
  startOverdueJob
};
