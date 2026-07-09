const express = require("express");
const Address = require("../models/Address");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, authorize } = require("../middleware/auth");
const { objectId, validateBody, z } = require("../middleware/validate");

const router = express.Router();
router.use(authenticate, authorize("buyer"));

const addressSchema = z.object({
  label: z.string().trim().max(60).optional().default("Home"),
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(6).max(30),
  line1: z.string().trim().min(3).max(240),
  line2: z.string().trim().max(240).optional().default(""),
  city: z.string().trim().min(2).max(80),
  area: z.string().trim().max(80).optional().default(""),
  postalCode: z.string().trim().max(20).optional().default(""),
  isDefault: z.boolean().optional().default(false)
});
const updateAddressSchema = addressSchema.partial().extend({ isDefault: z.boolean().optional() });

router.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(await Address.find({ userId: req.user._id }).sort({ isDefault: -1, createdAt: -1 }));
  })
);

router.post(
  "/",
  validateBody(addressSchema),
  asyncHandler(async (req, res) => {
    if (req.body.isDefault) await Address.updateMany({ userId: req.user._id }, { isDefault: false });
    const address = await Address.create({ ...req.body, userId: req.user._id });
    res.status(201).json(address);
  })
);

router.patch(
  "/:id",
  validateBody(updateAddressSchema),
  asyncHandler(async (req, res) => {
    if (req.body.isDefault) await Address.updateMany({ userId: req.user._id }, { isDefault: false });
    const address = await Address.findOneAndUpdate({ _id: req.params.id, userId: req.user._id }, req.body, { new: true });
    if (!address) return res.status(404).json({ message: "Address not found" });
    res.json(address);
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const address = await Address.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!address) return res.status(404).json({ message: "Address not found" });
    res.json({ message: "Address deleted" });
  })
);

module.exports = router;
