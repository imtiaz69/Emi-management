const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, authorize } = require("../middleware/auth");
const { objectId, validateBody, validateQuery, z } = require("../middleware/validate");
const {
  cancelOrder,
  getOrderForUser,
  listOrdersForUser,
  updateOrderFulfillment
} = require("../services/orderService");
const { checkoutFromCart } = require("../services/checkoutService");
const { requireVerified } = require("../middleware/security");

const router = express.Router();
router.use(authenticate);

const addressSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(6).max(30),
  line1: z.string().trim().min(3).max(240),
  line2: z.string().trim().max(240).optional().default(""),
  city: z.string().trim().min(2).max(80),
  area: z.string().trim().max(80).optional().default(""),
  postalCode: z.string().trim().max(20).optional().default("")
});
const fromCartSchema = z.object({
  shippingAddress: addressSchema,
  billingAddress: addressSchema.optional(),
  couponCode: z.string().trim().max(40).optional().default(""),
  deliveryCharge: z.coerce.number().min(0).optional().default(0),
  itemIds: z.array(objectId).optional().default([]),
  emi: z
    .object({
      items: z
        .array(
          z.object({
            cartItemId: objectId,
            downPayment: z.coerce.number().min(0),
            tenureMonths: z.coerce.number().int().min(3).max(60)
          })
        )
        .optional()
        .default([]),
      downPayment: z.coerce.number().min(0).optional().default(0),
      interestRate: z.coerce.number().min(0).max(100).optional().default(12),
      interestType: z.enum(["flat", "reducing", "zero"]).optional().default("flat"),
      tenureMonths: z.coerce.number().int().min(3).max(60).optional().default(6)
    })
    .optional()
    .default({})
});
const listSchema = z.object({
  fulfillmentStatus: z.enum(["pending", "confirmed", "processing", "shipped", "delivered", "cancelled", "returned"]).optional(),
  paymentStatus: z.enum(["unpaid", "partial", "paid", "refunded"]).optional()
});
const fulfillmentSchema = z.object({
  fulfillmentStatus: z.enum(["confirmed", "processing", "shipped", "delivered", "cancelled", "returned"]),
  courierName: z.string().trim().max(100).optional().default(""),
  trackingNo: z.string().trim().max(100).optional().default(""),
  shipmentStatus: z.enum(["pending", "packed", "shipped", "delivered", "failed"]).optional()
});
router.post(
  "/from-cart",
  authorize("buyer"),
  requireVerified,
  validateBody(fromCartSchema),
  asyncHandler(async (req, res) => {
    const order = await checkoutFromCart({ ...req.body, buyerId: req.user._id });
    res.status(201).json(order);
  })
);

router.get(
  "/",
  validateQuery(listSchema),
  asyncHandler(async (req, res) => {
    res.json(await listOrdersForUser(req.user, req.validatedQuery || {}));
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const order = await getOrderForUser(req.params.id, req.user);
    if (!order) return res.status(404).json({ message: "Order not found" });
    res.json(order);
  })
);

router.patch(
  "/:id/cancel",
  asyncHandler(async (req, res) => {
    res.json(await cancelOrder(req.params.id, req.user));
  })
);

router.patch(
  "/:id/status",
  authorize("seller", "admin"),
  validateBody(fulfillmentSchema),
  asyncHandler(async (req, res) => {
    if (req.user.role === "admin") return res.status(400).json({ message: "Admin order status updates will be added through admin operations" });
    res.json(await updateOrderFulfillment(req.params.id, req.user._id, req.body));
  })
);

module.exports = router;
