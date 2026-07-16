const bcrypt = require("bcryptjs");
const express = require("express");
const User = require("../models/User");
const SellerProfile = require("../models/SellerProfile");
const BuyerProfile = require("../models/BuyerProfile");
const RefreshToken = require("../models/RefreshToken");
const asyncHandler = require("../utils/asyncHandler");
const { isStrongPassword } = require("../utils/password");
const { createRefreshTokenValue, getRefreshExpiry, hashToken, signToken } = require("../utils/tokens");
const { writeAudit } = require("../services/auditService");
const { sendVerificationEmail } = require("../services/emailService");
const { validateBody, z } = require("../middleware/validate");
const { authenticate } = require("../middleware/auth");

const router = express.Router();
const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(180),
  phone: z.string().trim().min(6).max(30),
  password: z.string().min(8).max(128),
  role: z.enum(["seller", "buyer"]),
  shopName: z.string().trim().max(160).optional().default(""),
  ownerName: z.string().trim().max(120).optional().default(""),
  address: z.string().trim().max(500).optional().default(""),
  businessType: z.string().trim().max(80).optional().default("Retail"),
  tradeLicenseNo: z.string().trim().max(80).optional().default(""),
  nidNumber: z.string().trim().max(80).optional().default("")
});
const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(128)
});
const verifyOtpSchema = z.object({
  email: z.string().trim().email(),
  otp: z.string().trim().min(4).max(10)
});
const resendVerificationSchema = z.object({
  email: z.string().trim().email()
});
const forgotPasswordSchema = z.object({
  email: z.string().trim().email()
});
const resetPasswordSchema = z.object({
  email: z.string().trim().email(),
  otp: z.string().trim().min(4).max(10),
  password: z.string().min(8).max(128)
});
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128)
});
const accountSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(6).max(30)
});
const refreshSchema = z.object({
  refreshToken: z.string().trim().min(32).max(300)
});

router.post(
  "/register",
  validateBody(registerSchema),
  asyncHandler(async (req, res) => {
    const { name, email, phone, password, role, shopName, ownerName, address, businessType, tradeLicenseNo, nidNumber } = req.body;
    const normalizedEmail = email.toLowerCase();
    const normalizedPhone = normalizeBangladeshPhone(phone);
    if (!["seller", "buyer"].includes(role)) return res.status(400).json({ message: "Role must be seller or buyer" });
    if (!isStrongPassword(password)) return res.status(400).json({ message: "Password must be 8+ chars with uppercase, number, and special character" });

    const exists = await User.findOne({ $or: [{ email: normalizedEmail }, { phone: { $in: getPhoneLookupVariants(normalizedPhone) } }] });
    if (exists) return res.status(409).json({ message: "Email or phone already exists" });

    const otp = generateOtp();
    const user = await User.create({
      name,
      email: normalizedEmail,
      phone: normalizedPhone,
      passwordHash: await bcrypt.hash(password, 10),
      role,
      status: role === "seller" ? "pending_admin_approval" : "active",
      isVerified: false,
      otpCode: otp,
      otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000)
    });

    if (role === "seller") {
      await SellerProfile.create({
        userId: user._id,
        shopName: shopName || `${name}'s Shop`,
        ownerName: ownerName || name,
        address: address || "Not provided",
        businessType,
        tradeLicenseNo
      });
    } else {
      await BuyerProfile.create({ userId: user._id, address: address || "", nidNumber: nidNumber || "" });
    }

    const emailResult = await sendVerificationEmail({ to: user.email, otp, name: user.name });
    await writeAudit(user._id, "auth.registered", "User", user._id, { role });
    res.status(201).json({
      message: "Account created. Please verify your email before logging in.",
      verificationRequired: true,
      email: user.email,
      user: sanitizeUser(user),
      ...getDevelopmentOtpPayload(emailResult, otp)
    });
  })
);

router.post(
  "/login",
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email?.toLowerCase() });
    if (!user) return res.status(401).json({ message: "Invalid credentials" });
    if (user.lockUntil && user.lockUntil > new Date()) return res.status(423).json({ message: "Account locked after failed login attempts" });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      user.failedLoginAttempts += 1;
      if (user.failedLoginAttempts >= 5) user.lockUntil = new Date(Date.now() + 15 * 60 * 1000);
      await user.save();
      return res.status(401).json({ message: "Invalid credentials" });
    }

    user.failedLoginAttempts = 0;
    user.lockUntil = undefined;
    user.lastLoginAt = new Date();
    await user.save();
    if (!user.isVerified) {
      return res.status(403).json({
        message: "Please verify your email before logging in.",
        verificationRequired: true,
        email: user.email
      });
    }
    res.json({ ...(await issueTokens(user, req)), user: sanitizeUser(user) });
  })
);

router.post(
  "/refresh",
  validateBody(refreshSchema),
  asyncHandler(async (req, res) => {
    const tokenHash = hashToken(req.body.refreshToken);
    const stored = await RefreshToken.findOne({ tokenHash, revokedAt: { $exists: false }, expiresAt: { $gt: new Date() } });
    if (!stored) return res.status(401).json({ message: "Invalid refresh token" });
    const user = await User.findById(stored.userId);
    if (!user || user.status === "suspended") return res.status(401).json({ message: "Refresh token user is not active" });

    const nextRefreshToken = createRefreshTokenValue();
    const nextHash = hashToken(nextRefreshToken);
    stored.revokedAt = new Date();
    stored.replacedByTokenHash = nextHash;
    await stored.save();
    await RefreshToken.create({
      userId: user._id,
      tokenHash: nextHash,
      expiresAt: getRefreshExpiry(),
      userAgent: req.get("user-agent") || "",
      ip: req.ip
    });
    res.json({ token: signToken(user), refreshToken: nextRefreshToken, user: sanitizeUser(user) });
  })
);

router.post(
  "/logout",
  validateBody(refreshSchema.partial()),
  asyncHandler(async (req, res) => {
    if (req.body.refreshToken) {
      await RefreshToken.findOneAndUpdate({ tokenHash: hashToken(req.body.refreshToken) }, { revokedAt: new Date() });
    }
    res.json({ message: "Logged out" });
  })
);

router.post(
  "/verify-otp",
  validateBody(verifyOtpSchema),
  asyncHandler(verifyEmailOtp)
);

router.post(
  "/verify-email",
  validateBody(verifyOtpSchema),
  asyncHandler(verifyEmailOtp)
);

router.post(
  "/resend-verification",
  validateBody(resendVerificationSchema),
  asyncHandler(async (req, res) => {
    const user = await User.findOne({ email: req.body.email.toLowerCase() });
    if (!user) return res.json({ message: "If the email exists and is unverified, a verification code has been sent." });
    if (user.isVerified) return res.json({ message: "Email is already verified.", alreadyVerified: true });

    const otp = generateOtp();
    user.otpCode = otp;
    user.otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();
    const emailResult = await sendVerificationEmail({ to: user.email, otp, name: user.name });
    await writeAudit(user._id, "auth.verification_resent", "User", user._id);
    res.json({
      message: "Verification code sent. Please check your email.",
      verificationRequired: true,
      email: user.email,
      ...getDevelopmentOtpPayload(emailResult, otp)
    });
  })
);

router.post(
  "/forgot-password",
  validateBody(forgotPasswordSchema),
  asyncHandler(async (req, res) => {
    const user = await User.findOne({ email: req.body.email.toLowerCase() });
    if (user) {
      user.otpCode = "123456";
      user.otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
      await user.save();
      await writeAudit(user._id, "auth.password_reset_requested", "User", user._id);
    }
    res.json({ message: "If the email exists, a reset OTP has been generated.", mockOtp: "123456" });
  })
);

router.post(
  "/reset-password",
  validateBody(resetPasswordSchema),
  asyncHandler(async (req, res) => {
    if (!isStrongPassword(req.body.password)) return res.status(400).json({ message: "Password must be 8+ chars with uppercase, number, and special character" });
    const user = await User.findOne({ email: req.body.email.toLowerCase() });
    if (!user || user.otpCode !== req.body.otp || user.otpExpiresAt < new Date()) return res.status(400).json({ message: "Invalid or expired OTP" });
    user.passwordHash = await bcrypt.hash(req.body.password, 10);
    user.otpCode = undefined;
    user.otpExpiresAt = undefined;
    user.failedLoginAttempts = 0;
    user.lockUntil = undefined;
    await user.save();
    await writeAudit(user._id, "auth.password_reset_completed", "User", user._id);
    res.json({ message: "Password reset successfully" });
  })
);

router.patch(
  "/change-password",
  authenticate,
  validateBody(changePasswordSchema),
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id);
    const valid = await bcrypt.compare(req.body.currentPassword, user.passwordHash);
    if (!valid) return res.status(400).json({ message: "Current password is incorrect" });
    if (!isStrongPassword(req.body.newPassword)) return res.status(400).json({ message: "Password must be 8+ chars with uppercase, number, and special character" });
    user.passwordHash = await bcrypt.hash(req.body.newPassword, 10);
    await user.save();
    await writeAudit(user._id, "auth.password_changed", "User", user._id);
    res.json({ message: "Password changed successfully" });
  })
);

router.patch(
  "/account",
  authenticate,
  validateBody(accountSchema),
  asyncHandler(async (req, res) => {
    const normalizedPhone = normalizeBangladeshPhone(req.body.phone);
    const existingPhone = await User.findOne({ phone: { $in: getPhoneLookupVariants(normalizedPhone) }, _id: { $ne: req.user._id } });
    if (existingPhone) return res.status(409).json({ message: "Phone number already exists" });
    const user = await User.findByIdAndUpdate(req.user._id, { name: req.body.name, phone: normalizedPhone }, { new: true });
    await writeAudit(req.user._id, "auth.account_updated", "User", user._id);
    res.json({ user: sanitizeUser(user) });
  })
);

async function verifyEmailOtp(req, res) {
  const { email, otp } = req.body;
  const user = await User.findOne({ email: email?.toLowerCase() });
  if (!user || user.otpCode !== otp || !user.otpExpiresAt || user.otpExpiresAt < new Date()) return res.status(400).json({ message: "Invalid or expired OTP" });
  user.isVerified = true;
  user.otpCode = undefined;
  user.otpExpiresAt = undefined;
  await user.save();
  await writeAudit(user._id, "auth.email_verified", "User", user._id);
  res.json({ message: "Email verified successfully. You can now log in.", user: sanitizeUser(user) });
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function normalizeBangladeshPhone(phone) {
  const compact = String(phone || "").trim().replace(/[\s().-]/g, "");
  if (/^01\d{9}$/.test(compact)) return `+88${compact}`;
  if (/^8801\d{9}$/.test(compact)) return `+${compact}`;
  if (/^\+8801\d{9}$/.test(compact)) return compact;
  const error = new Error("Please enter a valid Bangladesh phone number, for example 01700000000 or +8801700000000");
  error.status = 400;
  throw error;
}

function getPhoneLookupVariants(normalizedPhone) {
  const local = normalizedPhone.replace(/^\+88/, "");
  const internationalWithoutPlus = normalizedPhone.replace(/^\+/, "");
  return [...new Set([normalizedPhone, local, internationalWithoutPlus])];
}

function getDevelopmentOtpPayload(emailResult, otp) {
  const shouldExposeOtp = process.env.NODE_ENV !== "production" || process.env.EXPOSE_EMAIL_OTP === "true";
  return {
    ...(emailResult?.mocked || shouldExposeOtp ? { mockOtp: otp } : {}),
    ...(emailResult?.error ? { emailWarning: emailResult.error } : {})
  };
}

function sanitizeUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
    isVerified: user.isVerified
  };
}

async function issueTokens(user, req) {
  const refreshToken = createRefreshTokenValue();
  await RefreshToken.create({
    userId: user._id,
    tokenHash: hashToken(refreshToken),
    expiresAt: getRefreshExpiry(),
    userAgent: req.get("user-agent") || "",
    ip: req.ip
  });
  return { token: signToken(user), refreshToken };
}

module.exports = router;
