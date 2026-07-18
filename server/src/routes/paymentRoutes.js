const express = require("express");
const Transaction = require("../models/Transaction");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, authorize, requireActiveSeller } = require("../middleware/auth");
const { requireVerified } = require("../middleware/security");
const { objectId, optionalObjectId, validateBody, z } = require("../middleware/validate");
const { recordPayment } = require("../services/loanService");
const { createReceiptDocument } = require("../services/pdfDocumentService");

const router = express.Router();
const allocationModeSchema = z.enum(["next_due", "next_n", "overdue", "advance", "custom"]).optional().default("advance");
const manualPaymentSchema = z.object({
  loanId: objectId,
  scheduleId: optionalObjectId,
  amount: z.coerce.number().min(1),
  method: z.enum(["cash", "bank", "cheque", "bkash", "nagad", "sslcommerz"]),
  allocationMode: allocationModeSchema,
  installmentCount: z.coerce.number().int().min(1).max(60).optional(),
  paymentDate: z.coerce.date().optional(),
  gatewayRef: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(500).optional().default("")
});
router.post(
  "/manual",
  authenticate,
  authorize("seller"),
  requireActiveSeller,
  requireVerified,
  validateBody(manualPaymentSchema),
  asyncHandler(async (req, res) => {
    const transaction = await recordPayment(req.body, req.user._id, { requireSellerOwnership: true });
    res.status(201).json(transaction);
  })
);

router.get(
  "/:id/receipt",
  authenticate,
  asyncHandler(async (req, res) => {
    const transaction = await Transaction.findById(req.params.id)
      .populate({ path: "loanId", populate: { path: "productId", select: "name" } })
      .populate("scheduleId", "installmentNo dueDate")
      .populate("orderId", "orderNo items")
      .populate("buyerId", "name email phone")
      .populate("sellerId", "name email phone");
    if (!transaction) return res.status(404).json({ message: "Payment receipt not found" });

    const canRead =
      req.user.role === "admin" ||
      transaction.buyerId?._id?.toString() === req.user._id.toString() ||
      transaction.sellerId?._id?.toString() === req.user._id.toString();
    if (!canRead) return res.status(403).json({ message: "You cannot download this payment receipt" });

    const fileName = `FinanceLend-receipt-${String(transaction.receiptNo || transaction._id).replace(/[^a-zA-Z0-9_-]/g, "")}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Cache-Control", "private, no-store");
    const document = createReceiptDocument(transaction);
    document.pipe(res);
    document.end();
  })
);

router.get(
  "/",
  authenticate,
  asyncHandler(async (req, res) => {
    const filter = {};
    if (req.user.role === "seller") filter.sellerId = req.user._id;
    if (req.user.role === "buyer") filter.buyerId = req.user._id;
    filter.status = "confirmed";
    const transactions = await Transaction.find(filter)
      .populate("loanId")
      .populate("orderId", "orderNo total paymentMode")
      .populate("buyerId", "name email phone")
      .populate("sellerId", "name email phone")
      .sort({ paymentDate: -1 })
      .limit(200);
    res.json(transactions);
  })
);

module.exports = router;
