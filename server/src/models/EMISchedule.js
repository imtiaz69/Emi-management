const mongoose = require("mongoose");

const emiScheduleSchema = new mongoose.Schema(
  {
    loanId: { type: mongoose.Schema.Types.ObjectId, ref: "Loan", required: true, index: true },
    buyerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    installmentNo: { type: Number, required: true },
    dueDate: { type: Date, required: true, index: true },
    principalAmount: { type: Number, required: true },
    interestAmount: { type: Number, required: true },
    lateFee: { type: Number, default: 0 },
    amountDue: { type: Number, required: true },
    amountPaid: { type: Number, default: 0 },
    paidAt: Date,
    status: {
      type: String,
      enum: ["pending", "partial", "paid", "overdue"],
      default: "pending",
      index: true
    }
  },
  { timestamps: true }
);

emiScheduleSchema.index({ loanId: 1, installmentNo: 1 }, { unique: true });

module.exports = mongoose.model("EMISchedule", emiScheduleSchema);
