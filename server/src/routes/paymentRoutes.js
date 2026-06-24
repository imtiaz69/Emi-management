const express = require("express");
const Transaction = require("../models/Transaction");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, authorize, requireActiveSeller } = require("../middleware/auth");
const { recordPayment } = require("../services/loanService");
const { createMockGatewayReference } = require("../services/paymentService");

const router = express.Router();

router.post(
  "/manual",
  authenticate,
  authorize("seller"),
  requireActiveSeller,
  asyncHandler(async (req, res) => {
    const transaction = await recordPayment(req.body, req.user._id);
    res.status(201).json(transaction);
  })
);

router.post(
  "/mock-gateway",
  authenticate,
  asyncHandler(async (req, res) => {
    const transaction = await recordPayment(
      { ...req.body, method: req.body.method || "mock_gateway", gatewayRef: createMockGatewayReference("PAY") },
      req.user._id
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
