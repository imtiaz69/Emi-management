import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { selectPaymentAllocationSchedules } = require("../services/loanService");

const schedules = [
  { _id: "s1", installmentNo: 1, dueDate: new Date("2026-01-01"), amountDue: 1000 },
  { _id: "s2", installmentNo: 2, dueDate: new Date("2026-02-01"), amountDue: 1000 },
  { _id: "s3", installmentNo: 3, dueDate: new Date("2026-03-01"), amountDue: 1000 },
  { _id: "s4", installmentNo: 4, dueDate: new Date("2026-04-01"), amountDue: 1000 }
];

describe("loanService payment allocation", () => {
  it("selects one schedule for next_due payments", () => {
    const selected = selectPaymentAllocationSchedules(schedules, { allocationMode: "next_due" });

    expect(selected.map((row) => row.installmentNo)).toEqual([1]);
  });

  it("selects the requested number of upcoming schedules for next_n payments", () => {
    const selected = selectPaymentAllocationSchedules(schedules, { allocationMode: "next_n", installmentCount: 3 });

    expect(selected.map((row) => row.installmentNo)).toEqual([1, 2, 3]);
  });

  it("rejects invalid next_n installment counts", () => {
    expect(() => selectPaymentAllocationSchedules(schedules, { allocationMode: "next_n", installmentCount: 0 })).toThrow("Installment count");
  });
});
