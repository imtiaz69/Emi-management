import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { calculateSchedule, calculateLateFee, calculateRiskScore, riskCategoryFromDays } = require("../services/emiService");

describe("emiService", () => {
  it("generates flat-rate schedules", () => {
    const result = calculateSchedule({ principal: 12000, downPayment: 0, interestRate: 12, interestType: "flat", tenureMonths: 12 });
    expect(result.schedule).toHaveLength(12);
    expect(result.totalPayable).toBe(13440);
  });

  it("generates zero-interest schedules", () => {
    const result = calculateSchedule({ principal: 9000, downPayment: 0, interestRate: 0, interestType: "zero", tenureMonths: 3 });
    expect(result.schedule[0].amountDue).toBe(3000);
    expect(result.totalPayable).toBe(9000);
  });

  it("generates reducing balance schedules", () => {
    const result = calculateSchedule({ principal: 10000, downPayment: 1000, interestRate: 12, interestType: "reducing", tenureMonths: 6 });
    expect(result.schedule).toHaveLength(6);
    expect(result.totalPayable).toBeGreaterThan(9000);
  });

  it("calculates late fees and risk categories", () => {
    const schedule = { dueDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), status: "overdue", amountDue: 1000 };
    expect(calculateLateFee(schedule, { type: "daily", value: 10 })).toBeGreaterThanOrEqual(60);
    expect(riskCategoryFromDays(20)).toBe("high");
    expect(calculateRiskScore({ overdueAmount: 2000, totalDaysOverdue: 10, totalEmis: 4, averageEmi: 1000 })).toBe(5);
  });
});
