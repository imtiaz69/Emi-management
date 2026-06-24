const dayjs = require("dayjs");

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function calculateSchedule({ principal, downPayment = 0, interestRate = 0, interestType = "flat", tenureMonths, startDate = new Date() }) {
  const financed = roundMoney(principal - downPayment);
  if (financed <= 0) {
    throw new Error("Principal must be greater than down payment");
  }
  if (tenureMonths < 3 || tenureMonths > 60) {
    throw new Error("Tenure must be between 3 and 60 months");
  }

  const rows = [];
  const monthlyRate = interestRate / 100 / 12;

  if (interestType === "zero" || interestRate === 0) {
    const monthlyPrincipal = roundMoney(financed / tenureMonths);
    let accumulatedPrincipal = 0;
    for (let i = 1; i <= tenureMonths; i += 1) {
      const isLastInstallment = i === tenureMonths;
      const principalAmount = isLastInstallment ? roundMoney(financed - accumulatedPrincipal) : monthlyPrincipal;
      accumulatedPrincipal += principalAmount;
      rows.push({
        installmentNo: i,
        dueDate: dayjs(startDate).add(i, "month").toDate(),
        principalAmount,
        interestAmount: 0,
        amountDue: principalAmount,
        amountPaid: 0,
        lateFee: 0,
        status: "pending",
        paidAt: null
      });
    }
  } else if (interestType === "flat") {
    const totalInterest = roundMoney(financed * (interestRate / 100) * (tenureMonths / 12));
    const monthlyPrincipal = roundMoney(financed / tenureMonths);
    const monthlyInterest = roundMoney(totalInterest / tenureMonths);
    let accumulatedPrincipal = 0;
    let accumulatedInterest = 0;
    for (let i = 1; i <= tenureMonths; i += 1) {
      const isLastInstallment = i === tenureMonths;
      const principalAmount = isLastInstallment ? roundMoney(financed - accumulatedPrincipal) : monthlyPrincipal;
      const interestAmount = isLastInstallment ? roundMoney(totalInterest - accumulatedInterest) : monthlyInterest;
      accumulatedPrincipal += principalAmount;
      accumulatedInterest += interestAmount;
      rows.push({
        installmentNo: i,
        dueDate: dayjs(startDate).add(i, "month").toDate(),
        principalAmount,
        interestAmount,
        amountDue: roundMoney(principalAmount + interestAmount),
        amountPaid: 0,
        lateFee: 0,
        status: "pending",
        paidAt: null
      });
    }
  } else if (interestType === "reducing") {
    const emi = roundMoney((financed * monthlyRate * Math.pow(1 + monthlyRate, tenureMonths)) / (Math.pow(1 + monthlyRate, tenureMonths) - 1));
    let remaining = financed;
    for (let i = 1; i <= tenureMonths; i += 1) {
      const isLastInstallment = i === tenureMonths;
      const interestAmount = roundMoney(remaining * monthlyRate);
      const principalAmount = isLastInstallment ? remaining : roundMoney(emi - interestAmount);
      remaining = roundMoney(remaining - principalAmount);
      rows.push({
        installmentNo: i,
        dueDate: dayjs(startDate).add(i, "month").toDate(),
        principalAmount,
        interestAmount,
        amountDue: roundMoney(principalAmount + interestAmount),
        amountPaid: 0,
        lateFee: 0,
        status: "pending",
        paidAt: null
      });
    }
  } else {
    throw new Error("Invalid interest type");
  }

  return {
    financed,
    totalPayable: roundMoney(rows.reduce((sum, row) => sum + row.amountDue, 0)),
    schedule: rows
  };
}

function calculateLateFee(schedule, policy, asOf = new Date()) {
  if (!policy || policy.type === "none" || schedule.status === "paid") return 0;
  const daysLate = Math.max(0, dayjs(asOf).diff(dayjs(schedule.dueDate), "day"));
  if (daysLate <= 0) return 0;
  if (policy.type === "fixed") return roundMoney(policy.value);
  if (policy.type === "daily") return roundMoney(policy.value * daysLate);
  if (policy.type === "percentage") return roundMoney((schedule.amountDue * policy.value) / 100);
  return 0;
}

function riskCategoryFromDays(days) {
  if (days > 30) return "critical";
  if (days >= 16) return "high";
  if (days >= 6) return "medium";
  return "low";
}

function calculateRiskScore({ overdueAmount, totalDaysOverdue, totalEmis, averageEmi }) {
  if (!totalEmis || !averageEmi) return 0;
  return roundMoney((overdueAmount * totalDaysOverdue) / (totalEmis * averageEmi));
}

module.exports = {
  calculateSchedule,
  calculateLateFee,
  calculateRiskScore,
  riskCategoryFromDays,
  roundMoney
};
