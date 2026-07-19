const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, required: true, unique: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["admin", "seller", "buyer"], required: true },
    status: {
      type: String,
      enum: ["pending_admin_approval", "active", "rejected", "suspended"],
      default: "active"
    },
    isVerified: { type: Boolean, default: false },
    otpCode: String,
    otpExpiresAt: Date,
    passwordResetOtpHash: String,
    passwordResetOtpExpiresAt: Date,
    passwordResetAttempts: { type: Number, default: 0 },
    passwordResetLastSentAt: Date,
    failedLoginAttempts: { type: Number, default: 0 },
    lockUntil: Date,
    lastLoginAt: Date
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
