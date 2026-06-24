const bcrypt = require("bcryptjs");
const express = require("express");
const User = require("../models/User");
const SellerProfile = require("../models/SellerProfile");
const BuyerProfile = require("../models/BuyerProfile");
const asyncHandler = require("../utils/asyncHandler");
const { isStrongPassword } = require("../utils/password");
const { signToken } = require("../utils/tokens");
const { writeAudit } = require("../services/auditService");

const router = express.Router();

router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const { name, email, phone, password, role, shopName, ownerName, address, businessType, tradeLicenseNo, nidNumber } = req.body;
    if (!["seller", "buyer"].includes(role)) return res.status(400).json({ message: "Role must be seller or buyer" });
    if (!isStrongPassword(password)) return res.status(400).json({ message: "Password must be 8+ chars with uppercase, number, and special character" });

    const exists = await User.findOne({ $or: [{ email: email?.toLowerCase() }, { phone }] });
    if (exists) return res.status(409).json({ message: "Email or phone already exists" });

    const user = await User.create({
      name,
      email,
      phone,
      passwordHash: await bcrypt.hash(password, 10),
      role,
      status: role === "seller" ? "pending_admin_approval" : "active",
      isVerified: role === "buyer",
      otpCode: "123456",
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

    await writeAudit(user._id, "auth.registered", "User", user._id, { role });
    const token = signToken(user);
    res.status(201).json({ token, user: sanitizeUser(user), mockOtp: "123456" });
  })
);

router.post(
  "/login",
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
    res.json({ token: signToken(user), user: sanitizeUser(user) });
  })
);

router.post(
  "/verify-otp",
  asyncHandler(async (req, res) => {
    const { email, otp } = req.body;
    const user = await User.findOne({ email: email?.toLowerCase() });
    if (!user || user.otpCode !== otp || user.otpExpiresAt < new Date()) return res.status(400).json({ message: "Invalid or expired OTP" });
    user.isVerified = true;
    user.otpCode = undefined;
    user.otpExpiresAt = undefined;
    await user.save();
    res.json({ message: "Verified", user: sanitizeUser(user) });
  })
);

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

module.exports = router;
