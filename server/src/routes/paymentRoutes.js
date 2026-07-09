const express = require("express");
const Transaction = require("../models/Transaction");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, authorize, requireActiveSeller } = require("../middleware/auth");
const { objectId, optionalObjectId, validateBody, z } = require("../middleware/validate");
const { recordPayment } = require("../services/loanService");
const { createMockGatewayReference } = require("../services/paymentService");

const router = express.Router();
const allocationModeSchema = z.enum(["next_due", "overdue", "advance", "custom"]).optional().default("advance");
const manualPaymentSchema = z.object({
  loanId: objectId,
  scheduleId: optionalObjectId,
  amount: z.coerce.number().min(1),
  method: z.enum(["cash", "bank", "cheque", "bkash", "nagad", "sslcommerz"]),
  allocationMode: allocationModeSchema,
  paymentDate: z.coerce.date().optional(),
  gatewayRef: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(500).optional().default("")
});
const mockPaymentSchema = z.object({
  loanId: objectId,
  scheduleId: optionalObjectId,
  amount: z.coerce.number().min(1),
  allocationMode: allocationModeSchema,
  method: z.enum(["mock_gateway"]).optional(),
  notes: z.string().trim().max(500).optional().default("")
});

router.post(
  "/manual",
  authenticate,
  authorize("seller"),
  requireActiveSeller,
  validateBody(manualPaymentSchema),
  asyncHandler(async (req, res) => {
    const transaction = await recordPayment(req.body, req.user._id, { requireSellerOwnership: true });
    res.status(201).json(transaction);
  })
);

router.post(
  "/mock-gateway",
  authenticate,
  authorize("buyer"),
  validateBody(mockPaymentSchema),
  asyncHandler(async (req, res) => {
    const transaction = await recordPayment(
      { ...req.body, method: req.body.method || "mock_gateway", gatewayRef: createMockGatewayReference("PAY") },
      req.user._id,
      { requireBuyerOwnership: true }
    );
    res.status(201).json(transaction);
  })
);

router.get(
  "/",
  authenticate,
  asyncHandler(async (req, res) => {
    const filter = {};
    if (req.user.role === "seller") filter.sellerId = req.user._id;
    if (req.user.role === "buyer") filter.buyerId = req.user._id;
    const transactions = await Transaction.find(filter)
      .populate("loanId")
      .populate("buyerId", "name email phone")
      .populate("sellerId", "name email phone")
      .sort({ paymentDate: -1 })
      .limit(200);
    res.json(transactions);
  })
);

module.exports = router;
