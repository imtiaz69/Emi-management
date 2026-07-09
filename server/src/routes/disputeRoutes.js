const express = require("express");
const Dispute = require("../models/Dispute");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, authorize } = require("../middleware/auth");
const { optionalObjectId, validateBody, z } = require("../middleware/validate");

const router = express.Router();
router.use(authenticate);

const disputeSchema = z.object({
  orderId: optionalObjectId,
  loanId: optionalObjectId,
  sellerId: optionalObjectId,
  subject: z.string().trim().min(3).max(160),
  message: z.string().trim().min(5).max(2000)
});
const updateDisputeSchema = z.object({
  status: z.enum(["open", "under_review", "resolved", "closed"])
});

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const filter = {};
    if (req.user.role === "buyer") filter.raisedBy = req.user._id;
    if (req.user.role === "seller") filter.sellerId = req.user._id;
    res.json(await Dispute.find(filter).sort({ createdAt: -1 }));
  })
);

router.post(
  "/",
  validateBody(disputeSchema),
  asyncHandler(async (req, res) => {
    const dispute = await Dispute.create({ ...req.body, raisedBy: req.user._id });
    res.status(201).json(dispute);
  })
);

router.patch(
  "/:id",
  authorize("admin"),
  validateBody(updateDisputeSchema),
  asyncHandler(async (req, res) => {
    const dispute = await Dispute.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true });
    if (!dispute) return res.status(404).json({ message: "Dispute not found" });
    res.json(dispute);
  })
);

module.exports = router;
