const mongoose = require("mongoose");

const emiApplicationSchema = new mongoose.Schema(
  {
    buyerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", index: true },
    orderItemId: { type: mongoose.Schema.Types.ObjectId },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    loanId: { type: mongoose.Schema.Types.ObjectId, ref: "Loan", index: true },
    requestedPrincipal: { type: Number, required: true, min: 1 },
    downPayment: { type: Number, default: 0, min: 0 },
    tenureMonths: { type: Number, required: true, min: 3, max: 60 },
    interestRate: { type: Number, default: 0, min: 0 },
    interestType: { type: String, enum: ["flat", "reducing", "zero"], default: "flat" },
    status: {
      type: String,
      enum: ["draft", "submitted", "kyc_pending", "under_review", "approved", "rejected", "converted_to_loan"],
      default: "submitted",
      index: true
    },
    riskScoreSnapshot: { type: Number, default: 0 },
    riskCategorySnapshot: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "low"
    },
    rejectionReason: String
  },
  { timestamps: true }
);

emiApplicationSchema.index({ sellerId: 1, status: 1, createdAt: -1 });
emiApplicationSchema.index({ buyerId: 1, createdAt: -1 });

module.exports = mongoose.model("EMIApplication", emiApplicationSchema);
