const mongoose = require("mongoose");

const fileSchema = new mongoose.Schema(
  {
    originalName: String,
    filename: String,
    path: String,
    mimetype: String,
    size: Number
  },
  { _id: false }
);

const kycDocumentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    type: { type: String, enum: ["nid", "passport"], required: true },
    files: [fileSchema],
    selfie: fileSchema,
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending", index: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewedAt: Date,
    rejectionReason: String
  },
  { timestamps: true }
);

kycDocumentSchema.index({ sellerId: 1, status: 1 });
kycDocumentSchema.index({ userId: 1, sellerId: 1, status: 1 });

module.exports = mongoose.model("KYCDocument", kycDocumentSchema);
