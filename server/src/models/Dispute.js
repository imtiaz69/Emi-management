const mongoose = require("mongoose");

const disputeSchema = new mongoose.Schema(
  {
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", index: true },
    loanId: { type: mongoose.Schema.Types.ObjectId, ref: "Loan" },
    raisedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    subject: { type: String, required: true },
    message: { type: String, required: true },
    status: { type: String, enum: ["open", "under_review", "resolved", "closed"], default: "open", index: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Dispute", disputeSchema);
