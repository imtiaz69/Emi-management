const mongoose = require("mongoose");

const kycReviewSchema = new mongoose.Schema(
  {
    kycDocumentId: { type: mongoose.Schema.Types.ObjectId, ref: "KYCDocument", required: true, index: true },
    reviewerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reviewerRole: { type: String, enum: ["admin", "seller"], required: true, index: true },
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    status: { type: String, enum: ["approved", "rejected"], required: true, index: true },
    rejectionReason: String,
    reviewedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

kycReviewSchema.index({ kycDocumentId: 1, reviewerRole: 1, sellerId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("KYCReview", kycReviewSchema);
