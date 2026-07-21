const mongoose = require("mongoose");

const identityVerificationResultSchema = new mongoose.Schema(
  {
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: "IdentityVerificationSession", required: true, unique: true },
    buyerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    overallStatus: {
      type: String,
      enum: ["VERIFIED", "PARTIALLY_VERIFIED", "FAILED", "MANUAL_REVIEW_REQUIRED", "PROCESSING"],
      required: true,
      index: true
    },
    checks: { type: mongoose.Schema.Types.Mixed, default: {} },
    fieldComparisons: { type: mongoose.Schema.Types.Mixed, default: {} },
    scores: { type: mongoose.Schema.Types.Mixed, default: {} },
    failureReasons: [{ type: String }],
    warnings: [{ type: String }],
    maskedData: { type: mongoose.Schema.Types.Mixed, default: {} },
    modelVersions: { type: mongoose.Schema.Types.Mixed, default: {} },
    thresholds: { type: mongoose.Schema.Types.Mixed, default: {} },
    automatedDecision: { type: String, enum: ["approved", "rejected", "pending"], default: "pending" },
    processedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

module.exports = mongoose.model("IdentityVerificationResult", identityVerificationResultSchema);
