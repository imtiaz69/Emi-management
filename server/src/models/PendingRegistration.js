const mongoose = require("mongoose");

const profileDataSchema = new mongoose.Schema(
  {
    shopName: { type: String, trim: true, default: "" },
    ownerName: { type: String, trim: true, default: "" },
    address: { type: String, trim: true, default: "" },
    businessType: { type: String, trim: true, default: "Retail" },
    tradeLicenseNo: { type: String, trim: true, default: "" },
    nidNumber: { type: String, trim: true, default: "" }
  },
  { _id: false }
);

const pendingRegistrationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, required: true, unique: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["seller", "buyer"], required: true },
    profileData: { type: profileDataSchema, default: () => ({}) },
    otpHash: { type: String, required: true },
    otpExpiresAt: { type: Date, required: true },
    verificationAttempts: { type: Number, default: 0 },
    lastSentAt: { type: Date, required: true },
    purgeAt: { type: Date, required: true }
  },
  { timestamps: true }
);

pendingRegistrationSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("PendingRegistration", pendingRegistrationSchema);
