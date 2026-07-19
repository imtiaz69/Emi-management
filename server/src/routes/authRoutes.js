const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const express = require("express");
const mongoose = require("mongoose");
const User = require("../models/User");
const SellerProfile = require("../models/SellerProfile");
const BuyerProfile = require("../models/BuyerProfile");
const PendingRegistration = require("../models/PendingRegistration");
const RefreshToken = require("../models/RefreshToken");
const asyncHandler = require("../utils/asyncHandler");
const { isStrongPassword } = require("../utils/password");
const { createRefreshTokenValue, getRefreshExpiry, hashToken, signToken } = require("../utils/tokens");
const { writeAudit } = require("../services/auditService");
const { sendPasswordResetEmail, sendVerificationEmail } = require("../services/emailService");
const { createNotification, notifyRole } = require("../services/notificationService");
const { validateBody, z } = require("../middleware/validate");
const { authenticate } = require("../middleware/auth");

const router = express.Router();
const OTP_TTL_MS = 10 * 60 * 1000;
const PENDING_REGISTRATION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;
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

    const conflictingPendingPhone = await PendingRegistration.findOne({
      email: { $ne: normalizedEmail },
      phone: { $in: getPhoneLookupVariants(normalizedPhone) }
    });
    if (conflictingPendingPhone) return res.status(409).json({ message: "Phone number is already waiting for verification" });

    const otp = generateOtp();
    const now = new Date();
    const pendingRegistration = await PendingRegistration.findOneAndUpdate(
      { email: normalizedEmail },
      {
        name,
        email: normalizedEmail,
        phone: normalizedPhone,
        passwordHash: await bcrypt.hash(password, 10),
        role,
        profileData: {
          shopName,
          ownerName,
          address,
          businessType,
          tradeLicenseNo,
          nidNumber
        },
        otpHash: await bcrypt.hash(otp, 10),
        otpExpiresAt: new Date(now.getTime() + OTP_TTL_MS),
        verificationAttempts: 0,
        lastSentAt: now,
        purgeAt: new Date(now.getTime() + PENDING_REGISTRATION_TTL_MS)
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );

    const emailResult = await sendVerificationEmail({ to: pendingRegistration.email, otp, name: pendingRegistration.name });
    res.status(201).json({
      message: "Verification code sent. Your account will be created after email verification.",
      verificationRequired: true,
      pendingRegistration: true,
      email: pendingRegistration.email,
      expiresInSeconds: OTP_TTL_MS / 1000,
      ...getDevelopmentOtpPayload(emailResult, otp)
    });
  })
);

router.post(
  "/login",
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const normalizedEmail = req.body.email?.toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      const pendingRegistration = await PendingRegistration.findOne({ email: normalizedEmail }).select("email");
      if (pendingRegistration) {
        return res.status(403).json({
          message: "Please verify your email to finish creating your account.",
          verificationRequired: true,
          email: pendingRegistration.email
        });
      }
      return res.status(401).json({ message: "Invalid credentials" });
    }
    if (user.lockUntil && user.lockUntil > new Date()) return res.status(423).json({ message: "Account locked after failed login attempts" });

    const valid = await bcrypt.compare(req.body.password, user.passwordHash);
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

/*
 * Existing unverified users from earlier project versions remain supported by
 * the verification and resend handlers below. New registrations use
 * PendingRegistration and do not create User/Profile records before OTP.
 */
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
    const normalizedEmail = req.body.email.toLowerCase();
    const pendingRegistration = await PendingRegistration.findOne({ email: normalizedEmail });
    if (pendingRegistration) {
      const elapsed = Date.now() - pendingRegistration.lastSentAt.getTime();
      if (elapsed < RESEND_COOLDOWN_MS) {
        const retryAfter = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
        return res.status(429).json({
          message: `Please wait ${retryAfter} seconds before requesting another code.`,
          retryAfter
        });
      }

      const otp = generateOtp();
      pendingRegistration.otpHash = await bcrypt.hash(otp, 10);
      pendingRegistration.otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);
      pendingRegistration.verificationAttempts = 0;
      pendingRegistration.lastSentAt = new Date();
      pendingRegistration.purgeAt = new Date(Date.now() + PENDING_REGISTRATION_TTL_MS);
      await pendingRegistration.save();
      const emailResult = await sendVerificationEmail({ to: pendingRegistration.email, otp, name: pendingRegistration.name });
      return res.json({
        message: "A new verification code was sent. Please check your email.",
        verificationRequired: true,
        email: pendingRegistration.email,
        expiresInSeconds: OTP_TTL_MS / 1000,
        ...getDevelopmentOtpPayload(emailResult, otp)
      });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) return res.json({ message: "If the email exists and is unverified, a verification code has been sent." });
    if (user.isVerified) return res.json({ message: "Email is already verified.", alreadyVerified: true });

    const otp = generateOtp();
    user.otpCode = otp;
    user.otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);
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
    const normalizedEmail = req.body.email.toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });
    if (user) {
      const elapsed = user.passwordResetLastSentAt ? Date.now() - user.passwordResetLastSentAt.getTime() : RESEND_COOLDOWN_MS;
      if (elapsed < RESEND_COOLDOWN_MS) {
        const retryAfter = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
        return res.status(429).json({
          message: `Please wait ${retryAfter} seconds before requesting another reset code.`,
          retryAfter
        });
      }

      const otp = generateOtp();
      user.passwordResetOtpHash = await bcrypt.hash(otp, 10);
      user.passwordResetOtpExpiresAt = new Date(Date.now() + OTP_TTL_MS);
      user.passwordResetAttempts = 0;
      user.passwordResetLastSentAt = new Date();
      await user.save();
      const recipient = getPasswordResetRecipient(user.email);
      let emailResult;
      try {
        emailResult = await sendPasswordResetEmail({ to: recipient, otp, name: user.name });
      } catch (error) {
        user.passwordResetOtpHash = undefined;
        user.passwordResetOtpExpiresAt = undefined;
        user.passwordResetAttempts = 0;
        user.passwordResetLastSentAt = undefined;
        await user.save();
        throw error;
      }
      await writeAudit(user._id, "auth.password_reset_requested", "User", user._id);
      return res.json({
        message: "A password reset code was sent to your email.",
        expiresInSeconds: OTP_TTL_MS / 1000,
        ...getDevelopmentOtpPayload(emailResult, otp)
      });
    }
    res.json({ message: "If an account exists for that email, a password reset code has been sent." });
  })
);

router.post(
  "/reset-password",
  validateBody(resetPasswordSchema),
  asyncHandler(async (req, res) => {
    if (!isStrongPassword(req.body.password)) return res.status(400).json({ message: "Password must be 8+ chars with uppercase, number, and special character" });
    const user = await User.findOne({ email: req.body.email.toLowerCase() });
    if (
      !user ||
      !user.passwordResetOtpHash ||
      !user.passwordResetOtpExpiresAt ||
      user.passwordResetOtpExpiresAt < new Date() ||
      user.passwordResetAttempts >= MAX_OTP_ATTEMPTS
    ) {
      return res.status(400).json({ message: "Invalid or expired password reset code" });
    }
    const validOtp = await bcrypt.compare(req.body.otp, user.passwordResetOtpHash);
    if (!validOtp) {
      user.passwordResetAttempts += 1;
      await user.save();
      return res.status(400).json({ message: "Invalid or expired password reset code" });
    }
    user.passwordHash = await bcrypt.hash(req.body.password, 10);
    user.passwordResetOtpHash = undefined;
    user.passwordResetOtpExpiresAt = undefined;
    user.passwordResetAttempts = 0;
    user.passwordResetLastSentAt = undefined;
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
  const normalizedEmail = req.body.email?.toLowerCase();
  const pendingRegistration = await PendingRegistration.findOne({ email: normalizedEmail });
  if (pendingRegistration) {
    if (!pendingRegistration.otpExpiresAt || pendingRegistration.otpExpiresAt < new Date()) {
      return res.status(400).json({ message: "Verification code has expired. Please request a new code." });
    }
    if (pendingRegistration.verificationAttempts >= MAX_OTP_ATTEMPTS) {
      return res.status(429).json({ message: "Too many incorrect attempts. Please request a new verification code." });
    }

    const validOtp = await bcrypt.compare(req.body.otp, pendingRegistration.otpHash);
    if (!validOtp) {
      pendingRegistration.verificationAttempts += 1;
      await pendingRegistration.save();
      const attemptsRemaining = Math.max(0, MAX_OTP_ATTEMPTS - pendingRegistration.verificationAttempts);
      return res.status(400).json({
        message: attemptsRemaining
          ? `Invalid verification code. ${attemptsRemaining} attempt${attemptsRemaining === 1 ? "" : "s"} remaining.`
          : "Too many incorrect attempts. Please request a new verification code."
      });
    }

    const user = await createVerifiedAccount(pendingRegistration._id, req.body.otp);
    return res.json({ message: "Email verified and account created successfully. You can now log in.", user: sanitizeUser(user) });
  }

  // Compatibility path for unverified users created before pending registrations were introduced.
  const user = await User.findOne({ email: normalizedEmail });
  if (!user || user.otpCode !== req.body.otp || !user.otpExpiresAt || user.otpExpiresAt < new Date()) {
    return res.status(400).json({ message: "Invalid or expired OTP" });
  }
  user.isVerified = true;
  user.otpCode = undefined;
  user.otpExpiresAt = undefined;
  await user.save();
  await writeAudit(user._id, "auth.email_verified", "User", user._id);
  return res.json({ message: "Email verified successfully. You can now log in.", user: sanitizeUser(user) });
}

async function createVerifiedAccount(pendingRegistrationId, otp) {
  const session = await mongoose.startSession();
  let createdUser;
  try {
    await session.withTransaction(async () => {
      const pending = await PendingRegistration.findById(pendingRegistrationId).session(session);
      if (!pending || pending.otpExpiresAt < new Date() || !(await bcrypt.compare(otp, pending.otpHash))) {
        const error = new Error("Invalid or expired OTP");
        error.status = 400;
        throw error;
      }

      const conflict = await User.findOne({
        $or: [{ email: pending.email }, { phone: { $in: getPhoneLookupVariants(pending.phone) } }]
      }).session(session);
      if (conflict) {
        const error = new Error("An account with this email or phone already exists");
        error.status = 409;
        throw error;
      }

      [createdUser] = await User.create(
        [
          {
            name: pending.name,
            email: pending.email,
            phone: pending.phone,
            passwordHash: pending.passwordHash,
            role: pending.role,
            status: pending.role === "seller" ? "pending_admin_approval" : "active",
            isVerified: true
          }
        ],
        { session }
      );

      if (pending.role === "seller") {
        await SellerProfile.create(
          [
            {
              userId: createdUser._id,
              shopName: pending.profileData.shopName || `${pending.name}'s Shop`,
              ownerName: pending.profileData.ownerName || pending.name,
              address: pending.profileData.address || "Not provided",
              businessType: pending.profileData.businessType || "Retail",
              tradeLicenseNo: pending.profileData.tradeLicenseNo
            }
          ],
          { session }
        );
      } else {
        await BuyerProfile.create(
          [
            {
              userId: createdUser._id,
              address: pending.profileData.address || "",
              nidNumber: pending.profileData.nidNumber || ""
            }
          ],
          { session }
        );
      }

      await writeAudit(createdUser._id, "auth.email_verified_account_created", "User", createdUser._id, { role: createdUser.role }, { session });
      await PendingRegistration.deleteOne({ _id: pending._id }, { session });
    });
  } finally {
    await session.endSession();
  }
  await createNotification({
    userId: createdUser._id,
    title: "Welcome to FinanceLend",
    messageType: "account_verified",
    message:
      createdUser.role === "seller"
        ? "Your email is verified. Your shop is now waiting for administrator approval."
        : "Your email is verified. You can now complete KYC and request products on EMI.",
    category: "account",
    severity: "success",
    actionUrl: createdUser.role === "seller" ? "/seller/pending" : "/buyer",
    metadata: { role: createdUser.role },
    dedupeKey: `user:${createdUser._id}:verified`
  }).catch((error) => console.error("Unable to create welcome notification", error));
  if (createdUser.role === "seller") {
    await notifyRole("admin", {
      title: "Seller approval required",
      messageType: "seller_awaiting_approval",
      message: `${createdUser.name} verified their email and submitted a seller account for approval.`,
      category: "account",
      severity: "warning",
      actionUrl: "/admin?tab=sellerApprovals",
      metadata: { sellerId: createdUser._id },
      dedupeKey: `seller:${createdUser._id}:awaiting-approval`
    }).catch((error) => console.error("Unable to create admin seller notification", error));
  }
  return createdUser;
}

function generateOtp() {
  return String(crypto.randomInt(100000, 1000000));
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
  const shouldExposeOtp = process.env.EMAIL_PROVIDER === "mock" && process.env.EXPOSE_EMAIL_OTP === "true";
  return {
    ...(emailResult?.mocked && shouldExposeOtp ? { mockOtp: otp } : {}),
    ...(emailResult?.error ? { emailWarning: emailResult.error } : {})
  };
}

function getPasswordResetRecipient(accountEmail) {
  const isDemoAccount = /@emi\.local$/i.test(accountEmail);
  return isDemoAccount && process.env.DEMO_EMAIL_RECIPIENT
    ? process.env.DEMO_EMAIL_RECIPIENT.trim().toLowerCase()
    : accountEmail;
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
