const express = require("express");
const BuyerProfile = require("../models/BuyerProfile");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, authorize } = require("../middleware/auth");
const { validateBody, z } = require("../middleware/validate");
const { getBuyerReadiness } = require("../services/buyerReadinessService");

const router = express.Router();

const buyerProfileSchema = z.object({
  address: z.string().trim().min(3).max(300),
  nidNumber: z.string().trim().min(5).max(40),
  emergencyContactName: z.string().trim().max(120).optional().default(""),
  emergencyContactPhone: z.string().trim().min(5).max(30),
  monthlyIncome: z.coerce.number().min(1),
  occupation: z.string().trim().min(2).max(120),
  employmentType: z.enum(["salaried", "self_employed", "business_owner", "student", "unemployed", "other"])
});

router.get(
  "/profile",
  authenticate,
  authorize("buyer"),
  asyncHandler(async (req, res) => {
    const profile = await BuyerProfile.findOneAndUpdate({ userId: req.user._id }, { $setOnInsert: { userId: req.user._id } }, { new: true, upsert: true });
    const readiness = await getBuyerReadiness(req.user._id);
    res.json({ profile, readiness: { ready: readiness.ready, missingFields: readiness.missingFields, hasKyc: readiness.hasKyc } });
  })
);

router.patch(
  "/profile",
  authenticate,
  authorize("buyer"),
  validateBody(buyerProfileSchema),
  asyncHandler(async (req, res) => {
    const profile = await BuyerProfile.findOneAndUpdate({ userId: req.user._id }, { ...req.body, userId: req.user._id }, { new: true, upsert: true });
    const readiness = await getBuyerReadiness(req.user._id);
    res.json({ profile, readiness: { ready: readiness.ready, missingFields: readiness.missingFields, hasKyc: readiness.hasKyc } });
  })
);

module.exports = router;
