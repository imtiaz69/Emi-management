const mongoose = require("mongoose");

const loanSchema = new mongoose.Schema(
  {
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    buyerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
    orderItemId: { type: mongoose.Schema.Types.ObjectId },
    selectedColorName: { type: String, trim: true },
    selectedColorHex: { type: String, trim: true },
    source: { type: String, enum: ["offline", "marketplace"], default: "offline" },
    principal: { type: Number, required: true, min: 0 },
    downPayment: { type: Number, default: 0, min: 0 },
    interestRate: { type: Number, default: 0, min: 0 },
    interestType: { type: String, enum: ["flat", "reducing", "zero"], default: "flat" },
    tenureMonths: { type: Number, required: true, min: 3, max: 60 },
    lateFeePolicy: {
      type: { type: String, enum: ["none", "fixed", "daily", "percentage"], default: "none" },
      value: { type: Number, default: 0 }
    },
    totalPayable: { type: Number, required: true },
    status: {
      type: String,
      enum: ["requested", "approved", "active", "rejected", "closed", "defaulted"],
      default: "active",
      index: true
    },
    kycApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    kycApprovedAt: Date,
    approvedAt: Date,
    activatedAt: Date,
    rejectionReason: String
  },
  { timestamps: true }
);

module.exports = mongoose.model("Loan", loanSchema);
