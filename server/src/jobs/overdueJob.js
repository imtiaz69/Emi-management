const cron = require("node-cron");
const dayjs = require("dayjs");
const EMISchedule = require("../models/EMISchedule");
const Loan = require("../models/Loan");
const BuyerProfile = require("../models/BuyerProfile");
const { calculateLateFee, calculateRiskScore, riskCategoryFromDays } = require("../services/emiService");
const { sendReminderSet } = require("../services/notificationService");

async function runOverdueCheck() {
  const now = new Date();
  const schedules = await EMISchedule.find({ status: { $in: ["pending", "partial", "overdue"] } }).populate("loanId");

  const affectedBuyers = new Map();
  for (const schedule of schedules) {
    const daysUntilDue = dayjs(schedule.dueDate).diff(dayjs(now), "day");
    const daysOverdue = dayjs(now).diff(dayjs(schedule.dueDate), "day");
    const loan = schedule.loanId;
    if (!loan) continue;

    if (daysUntilDue === 3) {
      await sendReminderSet({
        userId: schedule.buyerId,
        loanId: loan._id,
        messageType: "pre_due",
        message: `Your EMI installment #${schedule.installmentNo} is due in 3 days.`
      });
    }

    if (daysOverdue >= 0 && [0, 1, 3, 7, 15, 30].includes(daysOverdue)) {
      schedule.status = daysOverdue > 0 ? "overdue" : schedule.status;
      schedule.lateFee = calculateLateFee(schedule, loan.lateFeePolicy, now);
      await schedule.save();
      await sendReminderSet({
        userId: schedule.buyerId,
        loanId: loan._id,
        messageType: daysOverdue === 0 ? "due_today" : "overdue",
        message: `Your EMI installment #${schedule.installmentNo} is ${daysOverdue === 0 ? "due today" : `${daysOverdue} day(s) overdue`}.`
      });
    }

    if (daysOverdue > 0) affectedBuyers.set(schedule.buyerId.toString(), true);
  }

  for (const buyerId of affectedBuyers.keys()) {
    const rows = await EMISchedule.find({ buyerId, status: "overdue" });
    const overdueAmount = rows.reduce((sum, row) => sum + Math.max(0, row.amountDue + row.lateFee - row.amountPaid), 0);
    const totalDaysOverdue = rows.reduce((sum, row) => sum + Math.max(0, dayjs().diff(dayjs(row.dueDate), "day")), 0);
    const totalEmis = await EMISchedule.countDocuments({ buyerId });
    const averageEmi = rows.length ? rows.reduce((sum, row) => sum + row.amountDue, 0) / rows.length : 0;
    const maxDays = rows.reduce((max, row) => Math.max(max, dayjs().diff(dayjs(row.dueDate), "day")), 0);
    await BuyerProfile.findOneAndUpdate(
      { userId: buyerId },
      { riskScore: calculateRiskScore({ overdueAmount, totalDaysOverdue, totalEmis, averageEmi }), riskCategory: riskCategoryFromDays(maxDays) },
      { upsert: false }
    );
  }

  return { checked: schedules.length, buyersUpdated: affectedBuyers.size };
}

function startOverdueJob() {
  cron.schedule("0 9 * * *", runOverdueCheck, { timezone: "Asia/Dhaka" });
}

module.exports = { runOverdueCheck, startOverdueJob };
