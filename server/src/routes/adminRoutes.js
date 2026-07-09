const express = require("express");
const User = require("../models/User");
const SellerProfile = require("../models/SellerProfile");
const AuditLog = require("../models/AuditLog");
const Product = require("../models/Product");
const Order = require("../models/Order");
const Loan = require("../models/Loan");
const Dispute = require("../models/Dispute");
const ReturnRequest = require("../models/ReturnRequest");
const SystemConfig = require("../models/SystemConfig");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, authorize } = require("../middleware/auth");
const { validateBody, z } = require("../middleware/validate");
const { writeAudit } = require("../services/auditService");

const router = express.Router();
router.use(authenticate, authorize("admin"));
const sellerDecisionSchema = z.object({
  reason: z.string().trim().max(500).optional().default("")
});
const productModerationSchema = z.object({
  approvalStatus: z.enum(["pending", "approved", "rejected"]).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  reason: z.string().trim().max(500).optional().default("")
});
const userStatusSchema = z.object({
  reason: z.string().trim().max(500).optional().default("")
});
const settingsSchema = z.object({
  allowedTenureMin: z.coerce.number().int().min(1).max(60).optional().default(3),
  allowedTenureMax: z.coerce.number().int().min(3).max(120).optional().default(60),
  maxInterestRate: z.coerce.number().min(0).max(100).optional().default(36),
  defaultLateFeeType: z.enum(["none", "fixed", "daily", "percentage"]).optional().default("daily"),
  defaultLateFeeValue: z.coerce.number().min(0).optional().default(20),
  stripeTestMode: z.boolean().optional().default(true),
  notificationEmailEnabled: z.boolean().optional().default(false),
  notificationSmsEnabled: z.boolean().optional().default(false)
});

router.get(
  "/overview",
  asyncHandler(async (_req, res) => {
    const [users, sellersPending, productsPending, activeLoans, orders, disputes, returns] = await Promise.all([
      User.countDocuments(),
      SellerProfile.countDocuments({ approvalStatus: "pending" }),
      Product.countDocuments({ approvalStatus: "pending" }),
      Loan.countDocuments({ status: "active" }),
      Order.countDocuments(),
      Dispute.countDocuments({ status: { $in: ["open", "under_review"] } }),
      ReturnRequest.countDocuments({ status: { $in: ["requested", "approved", "received"] } })
    ]);
    res.json({ users, sellersPending, productsPending, activeLoans, orders, disputes, returns });
  })
);

router.get(
  "/sellers/pending",
  asyncHandler(async (_req, res) => {
    const sellers = await SellerProfile.find({ approvalStatus: "pending" }).populate("userId", "name email phone status createdAt");
    res.json(sellers);
  })
);

router.get(
  "/sellers",
  asyncHandler(async (req, res) => {
    const filter = {};
    if (req.query.status) filter.approvalStatus = req.query.status;
    const sellers = await SellerProfile.find(filter).populate("userId", "name email phone status createdAt").sort({ createdAt: -1 }).limit(300);
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
  validateBody(sellerDecisionSchema),
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
  validateBody(sellerDecisionSchema),
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

router.patch(
  "/sellers/:id/needs-info",
  validateBody(sellerDecisionSchema),
  asyncHandler(async (req, res) => {
    const profile = await SellerProfile.findById(req.params.id);
    if (!profile) return res.status(404).json({ message: "Seller profile not found" });
    profile.approvalStatus = "needs_info";
    profile.rejectionReason = req.body.reason || "More business information is required";
    await profile.save();
    await User.findByIdAndUpdate(profile.userId, { status: "pending_admin_approval" });
    await writeAudit(req.user._id, "seller.needs_info", "SellerProfile", profile._id, { reason: profile.rejectionReason });
    res.json(profile);
  })
);

router.patch(
  "/sellers/:id/reset",
  asyncHandler(async (req, res) => {
    const profile = await SellerProfile.findById(req.params.id);
    if (!profile) return res.status(404).json({ message: "Seller profile not found" });
    profile.approvalStatus = "pending";
    profile.rejectionReason = undefined;
    profile.approvedBy = undefined;
    profile.approvedAt = undefined;
    await profile.save();
    await User.findByIdAndUpdate(profile.userId, { status: "pending_admin_approval" });
    await writeAudit(req.user._id, "seller.approval_reset", "SellerProfile", profile._id);
    res.json(profile);
  })
);

router.get(
  "/products",
  asyncHandler(async (req, res) => {
    const filter = {};
    if (req.query.approvalStatus) filter.approvalStatus = req.query.approvalStatus;
    const products = await Product.find(filter).populate("sellerId", "name email phone").sort({ createdAt: -1 }).limit(300);
    res.json(products);
  })
);

router.patch(
  "/products/:id/moderate",
  validateBody(productModerationSchema),
  asyncHandler(async (req, res) => {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found" });
    if (req.body.approvalStatus) product.approvalStatus = req.body.approvalStatus;
    if (req.body.status) product.status = req.body.status;
    await product.save();
    await writeAudit(req.user._id, "product.moderated", "Product", product._id, req.body);
    res.json(product);
  })
);

router.get(
  "/orders",
  asyncHandler(async (_req, res) => {
    const orders = await Order.find().populate("buyerId", "name email phone").populate("sellerIds", "name email phone").sort({ createdAt: -1 }).limit(300);
    res.json(orders);
  })
);

router.get(
  "/portfolio",
  asyncHandler(async (_req, res) => {
    const rows = await Loan.aggregate([{ $group: { _id: "$status", principal: { $sum: "$principal" }, totalPayable: { $sum: "$totalPayable" }, count: { $sum: 1 } } }]);
    res.json(rows.map((row) => ({ status: row._id, principal: row.principal, totalPayable: row.totalPayable, count: row.count })));
  })
);

router.get(
  "/disputes",
  asyncHandler(async (_req, res) => {
    res.json(await Dispute.find().populate("raisedBy", "name email phone").populate("sellerId", "name email phone").sort({ createdAt: -1 }).limit(300));
  })
);

router.get(
  "/returns",
  asyncHandler(async (_req, res) => {
    res.json(await ReturnRequest.find().populate("buyerId", "name email phone").populate("sellerId", "name email phone").populate("orderId").sort({ createdAt: -1 }).limit(300));
  })
);

router.get(
  "/settings",
  asyncHandler(async (_req, res) => {
    const config = await SystemConfig.findOneAndUpdate(
      { key: "platform" },
      { $setOnInsert: { key: "platform", value: settingsSchema.parse({}) } },
      { upsert: true, new: true }
    );
    res.json(config.value);
  })
);

router.patch(
  "/settings",
  validateBody(settingsSchema),
  asyncHandler(async (req, res) => {
    const config = await SystemConfig.findOneAndUpdate({ key: "platform" }, { key: "platform", value: req.body, updatedBy: req.user._id }, { upsert: true, new: true });
    await writeAudit(req.user._id, "system.settings_updated", "SystemConfig", config._id, req.body);
    res.json(config.value);
  })
);

router.patch(
  "/users/:id/suspend",
  validateBody(userStatusSchema),
  asyncHandler(async (req, res) => {
    if (req.params.id === req.user._id.toString()) return res.status(400).json({ message: "You cannot suspend your own account" });
    const user = await User.findByIdAndUpdate(req.params.id, { status: "suspended" }, { new: true }).select("-passwordHash");
    if (!user) return res.status(404).json({ message: "User not found" });
    await writeAudit(req.user._id, "user.suspended", "User", user._id, { reason: req.body.reason });
    res.json(user);
  })
);

router.patch(
  "/users/:id/reactivate",
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id).select("-passwordHash");
    if (!user) return res.status(404).json({ message: "User not found" });
    user.status = user.role === "seller" ? "pending_admin_approval" : "active";
    if (user.role === "seller") {
      const profile = await SellerProfile.findOne({ userId: user._id });
      if (profile?.approvalStatus === "approved") user.status = "active";
    }
    await user.save();
    await writeAudit(req.user._id, "user.reactivated", "User", user._id);
    res.json(user);
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
