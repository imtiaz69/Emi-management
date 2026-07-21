const mongoose = require("mongoose");

const fileSchema = new mongoose.Schema(
  {
    originalName: String,
    filename: String,
    path: String,
    publicId: String,
    resourceType: String,
    mimetype: String,
    size: Number
  },
  { _id: false }
);

const KYC_DOCUMENT_TYPES = [
  "nid",
  "passport",
  "tin_certificate",
  "job_id_card",
  "salary_certificate",
  "bank_statement",
  "utility_bill",
  "other"
];

const kycDocumentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    type: { type: String, enum: KYC_DOCUMENT_TYPES, required: true },
    files: [fileSchema],
    selfie: fileSchema,
    identityVerificationSessionId: { type: mongoose.Schema.Types.ObjectId, ref: "IdentityVerificationSession", index: true },
    verificationMethod: { type: String, enum: ["manual_upload", "identity_cross_validation"], default: "manual_upload" },
    automatedVerification: {
      overallStatus: String,
      resultId: { type: mongoose.Schema.Types.ObjectId, ref: "IdentityVerificationResult" },
      processedAt: Date,
      revokedAt: Date,
      revokedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      revocationReason: String
    },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending", index: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewedAt: Date,
    rejectionReason: String
  },
  { timestamps: true }
);

kycDocumentSchema.index({ sellerId: 1, status: 1 });
kycDocumentSchema.index({ userId: 1, sellerId: 1, status: 1 });

const KYCDocument = mongoose.model("KYCDocument", kycDocumentSchema);

module.exports = KYCDocument;
module.exports.KYC_DOCUMENT_TYPES = KYC_DOCUMENT_TYPES;
