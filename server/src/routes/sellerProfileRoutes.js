const express = require("express");
const SellerProfile = require("../models/SellerProfile");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, authorize, requireActiveSeller } = require("../middleware/auth");
const { validateBody, z } = require("../middleware/validate");
const { writeAudit } = require("../services/auditService");

const router = express.Router();
router.use(authenticate, authorize("seller"));

const sellerProfileSchema = z.object({
  shopName: z.string().trim().min(2).max(160),
  ownerName: z.string().trim().min(2).max(120),
  address: z.string().trim().min(3).max(500),
  businessType: z.string().trim().max(80).optional().default("Retail"),
  tradeLicenseNo: z.string().trim().max(80).optional().default("")
});

router.get(
  "/me",
  asyncHandler(async (req, res) => {
    const profile = await SellerProfile.findOne({ userId: req.user._id }).populate("userId", "name email phone status");
    if (!profile) return res.status(404).json({ message: "Seller profile not found" });
    res.json(profile);
  })
);

router.patch(
  "/me",
  requireActiveSeller,
  validateBody(sellerProfileSchema),
  asyncHandler(async (req, res) => {
    const profile = await SellerProfile.findOneAndUpdate({ userId: req.user._id }, req.body, { new: true, upsert: true });
    await writeAudit(req.user._id, "sellerProfile.updated", "SellerProfile", profile._id);
    res.json(profile);
  })
);

module.exports = router;
