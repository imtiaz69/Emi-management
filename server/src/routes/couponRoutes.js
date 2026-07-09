const express = require("express");
const Coupon = require("../models/Coupon");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, authorize } = require("../middleware/auth");
const { validateBody, z } = require("../middleware/validate");

const router = express.Router();
const couponSchema = z.object({
  code: z.string().trim().min(3).max(40),
  type: z.enum(["percentage", "fixed"]),
  value: z.coerce.number().min(1),
  minOrderAmount: z.coerce.number().min(0).optional().default(0),
  maxDiscount: z.coerce.number().min(0).optional().default(0),
  active: z.boolean().optional().default(true)
});
const validateCouponSchema = z.object({
  code: z.string().trim().min(3).max(40),
  subtotal: z.coerce.number().min(0)
});

router.post(
  "/validate",
  validateBody(validateCouponSchema),
  asyncHandler(async (req, res) => {
    const coupon = await Coupon.findOne({ code: req.body.code.toUpperCase(), active: true });
    if (!coupon || req.body.subtotal < coupon.minOrderAmount) return res.status(404).json({ message: "Coupon not applicable" });
    const raw = coupon.type === "percentage" ? (req.body.subtotal * coupon.value) / 100 : coupon.value;
    const discount = Math.min(req.body.subtotal, coupon.maxDiscount ? Math.min(raw, coupon.maxDiscount) : raw);
    res.json({ coupon, discount });
  })
);

router.post(
  "/",
  authenticate,
  authorize("admin"),
  validateBody(couponSchema),
  asyncHandler(async (req, res) => {
    const coupon = await Coupon.create({ ...req.body, code: req.body.code.toUpperCase() });
    res.status(201).json(coupon);
  })
);

module.exports = router;
