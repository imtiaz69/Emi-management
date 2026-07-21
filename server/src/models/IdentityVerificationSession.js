const mongoose = require("mongoose");

const SESSION_STATUSES = [
  "CREATED",
  "CAPTURING",
  "QUEUED",
  "WAKING_AI",
  "PROCESSING",
  "COMPLETED",
  "EXPIRED",
  "CANCELLED",
  "ERROR"
];

const artifactSchema = new mongoose.Schema(
  {
    publicId: String,
    resourceType: { type: String, enum: ["image", "video"] },
    format: String,
    bytes: Number,
    width: Number,
    height: Number,
    duration: Number,
    capturedAt: Date
  },
  { _id: false }
);

const pendingUploadSchema = new mongoose.Schema(
  {
    publicId: String,
    resourceType: String,
    expiresAt: Date
  },
  { _id: false }
);

const encryptedPayloadSchema = new mongoose.Schema(
  {
    iv: String,
    tag: String,
    ciphertext: String
  },
  { _id: false }
);

const identityVerificationSessionSchema = new mongoose.Schema(
  {
    buyerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    initiatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    initiatorRole: { type: String, enum: ["buyer", "seller", "admin"], required: true },
    verificationType: { type: String, enum: ["full_identity", "nid_cross_check"], default: "full_identity", index: true },
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    kycDocumentId: { type: mongoose.Schema.Types.ObjectId, ref: "KYCDocument" },
    linkTokenHash: { type: String, select: false },
    uploadTokenHash: { type: String, select: false },
    linkUsedAt: Date,
    expiresAt: { type: Date, required: true, index: true },
    status: { type: String, enum: SESSION_STATUSES, default: "CREATED", index: true },
    challenge: [{ type: String, enum: ["BLINK", "TURN_LEFT", "TURN_RIGHT"] }],
    captureMode: { type: String, enum: ["video", "selfie", "document_only"] },
    artifacts: {
      front: artifactSchema,
      back: artifactSchema,
      liveness: artifactSchema
    },
    pendingUploads: {
      front: pendingUploadSchema,
      back: pendingUploadSchema,
      liveness: pendingUploadSchema
    },
    captureAttempts: {
      front: { type: Number, default: 0 },
      back: { type: Number, default: 0 },
      liveness: { type: Number, default: 0 }
    },
    processingAttempts: { type: Number, default: 0 },
    processingLeaseAt: Date,
    nextAttemptAt: Date,
    lastError: String,
    sensitivePayload: { type: encryptedPayloadSchema, select: false },
    completedAt: Date,
    purgeAt: Date,
    purgedAt: Date
  },
  { timestamps: true }
);

identityVerificationSessionSchema.index({ status: 1, nextAttemptAt: 1, processingLeaseAt: 1 });
identityVerificationSessionSchema.index({ initiatedBy: 1, createdAt: -1 });

const IdentityVerificationSession = mongoose.model("IdentityVerificationSession", identityVerificationSessionSchema);

module.exports = IdentityVerificationSession;
module.exports.SESSION_STATUSES = SESSION_STATUSES;
