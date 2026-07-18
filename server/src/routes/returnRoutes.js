const express = require("express");
const ReturnRequest = require("../models/ReturnRequest");
const Order = require("../models/Order");
const Transaction = require("../models/Transaction");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, authorize } = require("../middleware/auth");
const { objectId, validateBody, z } = require("../middleware/validate");
const { createNotification, notifyRole } = require("../services/notificationService");

const router = express.Router();
router.use(authenticate);

const createReturnSchema = z.object({
  orderId: objectId,
  sellerId: objectId,
  reason: z.string().trim().min(5).max(1000)
});
const updateReturnSchema = z.object({
  status: z.enum(["requested", "approved", "rejected", "received", "refunded"])
});

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const filter = {};
    if (req.user.role === "buyer") filter.buyerId = req.user._id;
    if (req.user.role === "seller") filter.sellerId = req.user._id;
    res.json(await ReturnRequest.find(filter).populate("orderId").sort({ createdAt: -1 }));
  })
);

router.post(
  "/",
  authorize("buyer"),
  validateBody(createReturnSchema),
  asyncHandler(async (req, res) => {
    const order = await Order.findOne({ _id: req.body.orderId, buyerId: req.user._id, sellerIds: req.body.sellerId });
    if (!order) return res.status(404).json({ message: "Order not found for return" });
    const request = await ReturnRequest.create({ ...req.body, buyerId: req.user._id });
    await Promise.all([
      createNotification({
        userId: request.sellerId,
        title: "New return request",
        messageType: "return_requested",
        message: `${req.user.name} requested a return for order ${order.orderNo}.`,
        category: "return",
        severity: "warning",
        actionUrl: `/orders/${order._id}`,
        metadata: { returnRequestId: request._id, orderId: order._id, buyerId: req.user._id },
        dedupeKey: `return:${request._id}:requested:seller`
      }),
      notifyRole("admin", {
        title: "Return request submitted",
        messageType: "return_requested",
        message: `${req.user.name} submitted a return request for order ${order.orderNo}.`,
        category: "return",
        severity: "info",
        actionUrl: "/admin?tab=disputes",
        metadata: { returnRequestId: request._id, orderId: order._id },
        dedupeKey: `return:${request._id}:requested:admin`
      })
    ]).catch((error) => console.error("Unable to create return notifications", error));
    res.status(201).json(request);
  })
);

router.patch(
  "/:id",
  authorize("seller", "admin"),
  validateBody(updateReturnSchema),
  asyncHandler(async (req, res) => {
    const filter = { _id: req.params.id };
    if (req.user.role === "seller") filter.sellerId = req.user._id;
    const request = await ReturnRequest.findOneAndUpdate(filter, { status: req.body.status }, { new: true });
    if (!request) return res.status(404).json({ message: "Return request not found" });
    if (req.body.status === "refunded") {
      await Transaction.updateMany({ orderId: request.orderId, sellerId: request.sellerId, status: "confirmed" }, { status: "refunded", notes: "Marked refunded from return request" });
    }
    await createNotification({
      userId: request.buyerId,
      title: "Return status updated",
      messageType: "return_status_updated",
      message: `Your return request is now ${String(request.status).replaceAll("_", " ")}.`,
      category: "return",
      severity: request.status === "refunded" ? "success" : request.status === "rejected" ? "critical" : "info",
      actionUrl: `/orders/${request.orderId}`,
      metadata: { returnRequestId: request._id, orderId: request.orderId, status: request.status },
      dedupeKey: `return:${request._id}:status:${request.status}:buyer`
    }).catch((error) => console.error("Unable to create return status notification", error));
    res.json(request);
  })
);

module.exports = router;
