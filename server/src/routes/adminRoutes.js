const express = require("express");
const User = require("../models/User");
const SellerProfile = require("../models/SellerProfile");
const AuditLog = require("../models/AuditLog");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, authorize } = require("../middleware/auth");
const { writeAudit } = require("../services/auditService");

const router = express.Router();
router.use(authenticate, authorize("admin"));

router.get(
  "/sellers/pending",
  asyncHandler(async (_req, res) => {
    const sellers = await SellerProfile.find({ approvalStatus: "pending" }).populate("userId", "name email phone status createdAt");
    res.json(sellers);
  })
);

router.get(
  "/users",
  asyncHandler(async (_req, res) => {
    const users = await User.find().select("-passwordHash").sort({ createdAt: -1 }).limit(200);
    res.json(users);
  })
);

router.patch(
  "/sellers/:id/approve",
  asyncHandler(async (req, res) => {
    const profile = await SellerProfile.findById(req.params.id);
    if (!profile) return res.status(404).json({ message: "Seller profile not found" });
    profile.approvalStatus = "approved";
    profile.approvedBy = req.user._id;
    profile.approvedAt = new Date();
    await profile.save();
    await User.findByIdAndUpdate(profile.userId, { status: "active", isVerified: true });
    await writeAudit(req.user._id, "seller.approved", "SellerProfile", profile._id);
    res.json(profile);
  })
);

router.patch(
  "/sellers/:id/reject",
  asyncHandler(async (req, res) => {
    const profile = await SellerProfile.findById(req.params.id);
    if (!profile) return res.status(404).json({ message: "Seller profile not found" });
    profile.approvalStatus = "rejected";
    profile.rejectionReason = req.body.reason || "Rejected by admin";
    await profile.save();
    await User.findByIdAndUpdate(profile.userId, { status: "rejected" });
    await writeAudit(req.user._id, "seller.rejected", "SellerProfile", profile._id, { reason: profile.rejectionReason });
    res.json(profile);
  })
);

router.get(
  "/audit",
  asyncHandler(async (_req, res) => {
    const logs = await AuditLog.find().populate("actorId", "name email role").sort({ createdAt: -1 }).limit(200);
    res.json(logs);
  })
);

module.exports = router;
