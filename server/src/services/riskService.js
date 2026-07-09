const BuyerProfile = require("../models/BuyerProfile");
const EMISchedule = require("../models/EMISchedule");
const KYCDocument = require("../models/KYCDocument");
const Loan = require("../models/Loan");

function riskCategory(score) {
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 35) return "medium";
  return "low";
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value || 0))));
}

async function calculateBuyerRiskProfile({ buyerId, principal = 0, downPayment = 0, session } = {}) {
  const [profile, kycCount, activeLoanCount, overdueSchedules, paidSchedules, historicalSchedules] = await Promise.all([
    BuyerProfile.findOne({ userId: buyerId }).session(session || null),
    KYCDocument.countDocuments({ userId: buyerId, status: { $in: ["pending", "approved"] } }).session(session || null),
    Loan.countDocuments({ buyerId, status: { $in: ["requested", "active"] } }).session(session || null),
    EMISchedule.find({ buyerId, status: "overdue" }).select("amountDue lateFee amountPaid dueDate").session(session || null),
    EMISchedule.countDocuments({ buyerId, status: "paid" }).session(session || null),
    EMISchedule.countDocuments({ buyerId }).session(session || null)
  ]);

  const overdueBalance = overdueSchedules.reduce((sum, row) => sum + Math.max(Number(row.amountDue || 0) + Number(row.lateFee || 0) - Number(row.amountPaid || 0), 0), 0);
  const maxDaysOverdue = overdueSchedules.reduce((max, row) => {
    const days = Math.max(0, Math.floor((Date.now() - new Date(row.dueDate).getTime()) / 86400000));
    return Math.max(max, days);
  }, 0);

  const overdueScore = clampScore(Math.min(100, overdueBalance / 500 + maxDaysOverdue * 2));
  const paymentHistoryScore = historicalSchedules === 0 ? 25 : clampScore(100 - (paidSchedules / historicalSchedules) * 100);
  const monthlyIncome = Number(profile?.monthlyIncome || 0);
  const loanToIncome = monthlyIncome > 0 ? Number(principal || 0) / monthlyIncome : 5;
  const debtToIncomeScore = clampScore(Math.min(100, loanToIncome * 25 + activeLoanCount * 8));
  const downPaymentRatio = Number(principal || 0) > 0 ? Number(downPayment || 0) / Number(principal || 0) : 0;
  const downPaymentScore = clampScore(100 - downPaymentRatio * 300);
  const requiredProfileComplete = Boolean(profile?.address && profile?.nidNumber && profile?.emergencyContactPhone && monthlyIncome > 0 && profile?.occupation && profile?.employmentType);
  const kycScore = kycCount > 0 && requiredProfileComplete ? 0 : kycCount > 0 ? 35 : 100;

  const score = clampScore(overdueScore * 0.35 + paymentHistoryScore * 0.25 + debtToIncomeScore * 0.2 + downPaymentScore * 0.1 + kycScore * 0.1);
  const category = riskCategory(score);

  if (profile) {
    profile.riskScore = score;
    profile.riskCategory = category;
    await profile.save({ session });
  }

  return {
    riskScore: score,
    riskCategory: category,
    inputs: {
      overdueBalance,
      maxDaysOverdue,
      activeLoanCount,
      paidSchedules,
      historicalSchedules,
      monthlyIncome,
      loanToIncome,
      downPaymentRatio,
      kycUploaded: kycCount > 0,
      profileComplete: requiredProfileComplete
    }
  };
}

module.exports = { calculateBuyerRiskProfile, riskCategory };
