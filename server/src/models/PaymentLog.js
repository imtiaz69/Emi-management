const mongoose = require("mongoose");

const paymentLogSchema = new mongoose.Schema(
  {
    provider: { type: String, enum: ["stripe", "mock"], required: true, index: true },
    sessionId: { type: String, index: true },
    paymentIntentId: { type: String, index: true },
    loanId: { type: mongoose.Schema.Types.ObjectId, ref: "Loan" },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
    buyerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    amount: { type: Number, default: 0 },
    currency: String,
    status: { type: String, enum: ["pending", "confirmed", "failed", "cancelled", "refunded"], default: "pending", index: true },
    eventType: String,
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: true }
);

paymentLogSchema.index({ provider: 1, sessionId: 1 }, { unique: true, sparse: true });
paymentLogSchema.index({ provider: 1, paymentIntentId: 1 }, { sparse: true });

module.exports = mongoose.model("PaymentLog", paymentLogSchema);
