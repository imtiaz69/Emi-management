const express = require("express");
const Dispute = require("../models/Dispute");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, authorize } = require("../middleware/auth");
const { optionalObjectId, validateBody, z } = require("../middleware/validate");
const { createNotification, notifyRole } = require("../services/notificationService");

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
    const tasks = [
      notifyRole("admin", {
        title: "New dispute opened",
        messageType: "dispute_opened",
        message: `${req.user.name} opened a dispute: ${dispute.subject}.`,
        category: "dispute",
        severity: "warning",
        actionUrl: "/admin?tab=disputes",
        metadata: { disputeId: dispute._id, raisedBy: req.user._id },
        dedupeKey: `dispute:${dispute._id}:opened:admin`
      })
    ];
    if (dispute.sellerId) {
      tasks.push(
        createNotification({
          userId: dispute.sellerId,
          title: "New customer dispute",
          messageType: "customer_dispute_opened",
          message: `${req.user.name} opened a dispute: ${dispute.subject}.`,
          category: "dispute",
          severity: "warning",
          actionUrl: "/seller",
          metadata: { disputeId: dispute._id, raisedBy: req.user._id },
          dedupeKey: `dispute:${dispute._id}:opened:seller`
        })
      );
    }
    await Promise.all(tasks).catch((error) => console.error("Unable to create dispute notifications", error));
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
    await Promise.all([
      createNotification({
        userId: dispute.raisedBy,
        title: "Dispute status updated",
        messageType: "dispute_status_updated",
        message: `Your dispute "${dispute.subject}" is now ${String(dispute.status).replaceAll("_", " ")}.`,
        category: "dispute",
        severity: dispute.status === "resolved" ? "success" : "info",
        actionUrl: "/account",
        metadata: { disputeId: dispute._id, status: dispute.status },
        dedupeKey: `dispute:${dispute._id}:status:${dispute.status}:raiser`
      }),
      dispute.sellerId
        ? createNotification({
            userId: dispute.sellerId,
            title: "Dispute status updated",
            messageType: "dispute_status_updated",
            message: `Dispute "${dispute.subject}" is now ${String(dispute.status).replaceAll("_", " ")}.`,
            category: "dispute",
            severity: dispute.status === "resolved" ? "success" : "info",
            actionUrl: "/seller",
            metadata: { disputeId: dispute._id, status: dispute.status },
            dedupeKey: `dispute:${dispute._id}:status:${dispute.status}:seller`
          })
        : Promise.resolve()
    ]).catch((error) => console.error("Unable to create dispute status notifications", error));
    res.json(dispute);
  })
);

module.exports = router;
