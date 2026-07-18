const express = require("express");
const NotificationLog = require("../models/NotificationLog");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

router.get(
  "/",
  authenticate,
  asyncHandler(async (req, res) => {
    const requestedLimit = Number(req.query.limit || 50);
    const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 50;
    const filter = { userId: req.user._id, channel: "in_app" };
    if (req.query.status === "unread") filter.isRead = false;
    if (req.query.category) filter.category = req.query.category;

    const [items, unreadCount, total] = await Promise.all([
      NotificationLog.find(filter)
        .populate("loanId", "status principal totalPayable")
        .sort({ sentAt: -1 })
        .limit(limit),
      NotificationLog.countDocuments({ userId: req.user._id, channel: "in_app", isRead: false }),
      NotificationLog.countDocuments(filter)
    ]);

    res.json({ items, unreadCount, total });
  })
);

router.patch(
  "/read-all",
  authenticate,
  asyncHandler(async (req, res) => {
    const now = new Date();
    const result = await NotificationLog.updateMany(
      { userId: req.user._id, channel: "in_app", isRead: false },
      { $set: { isRead: true, readAt: now } }
    );
    res.json({ updated: result.modifiedCount });
  })
);

router.patch(
  "/:id/read",
  authenticate,
  asyncHandler(async (req, res) => {
    const notification = await NotificationLog.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id, channel: "in_app" },
      { $set: { isRead: true, readAt: new Date() } },
      { new: true }
    );
    if (!notification) return res.status(404).json({ message: "Notification not found" });
    return res.json(notification);
  })
);

router.delete(
  "/:id",
  authenticate,
  asyncHandler(async (req, res) => {
    const notification = await NotificationLog.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id,
      channel: "in_app"
    });
    if (!notification) return res.status(404).json({ message: "Notification not found" });
    return res.json({ message: "Notification removed" });
  })
);

module.exports = router;
