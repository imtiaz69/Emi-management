const express = require("express");
const Loan = require("../models/Loan");
const EMISchedule = require("../models/EMISchedule");
const EMIApplication = require("../models/EMIApplication");
const KYCDocument = require("../models/KYCDocument");
const KYCReview = require("../models/KYCReview");
const LoanAgreement = require("../models/LoanAgreement");
const Product = require("../models/Product");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, authorize, requireActiveSeller } = require("../middleware/auth");
const { requireVerified } = require("../middleware/security");
const { objectId, optionalObjectId, validateBody, z } = require("../middleware/validate");
const { calculateSchedule } = require("../services/emiService");
const { approveLoanRequest, createLoanWithSchedule } = require("../services/loanService");
const { writeAudit } = require("../services/auditService");
const { assertBuyerReadyForEmi } = require("../services/buyerReadinessService");
const { ensureLoanAgreement } = require("../services/agreementService");

const router = express.Router();
const lateFeePolicySchema = z.object({
  type: z.enum(["none", "fixed", "daily", "percentage"]).optional().default("none"),
  value: z.coerce.number().min(0).optional().default(0)
});
const loanPreviewSchema = z.object({
  sellerId: optionalObjectId,
  buyerId: optionalObjectId,
  productId: optionalObjectId,
  principal: z.coerce.number().min(1),
  downPayment: z.coerce.number().min(0).optional().default(0),
  interestRate: z.coerce.number().min(0).max(100).optional().default(0),
  interestType: z.enum(["flat", "reducing", "zero"]).optional().default("flat"),
  tenureMonths: z.coerce.number().int().min(3).max(60),
  lateFeePolicy: lateFeePolicySchema.optional(),
  startDate: z.coerce.date().optional()
});
const offlineLoanSchema = loanPreviewSchema.extend({
  buyerId: objectId,
  productId: optionalObjectId
});
const marketplaceLoanRequestSchema = loanPreviewSchema.extend({
  sellerId: objectId,
  productId: objectId,
  selectedColorName: z.string().trim().min(1).max(40).optional()
});
const rejectLoanSchema = z.object({
  reason: z.string().trim().max(500).optional().default("Rejected by seller")
});

router.get(
  "/",
  authenticate,
  asyncHandler(async (req, res) => {
    const filter = {};
    if (req.user.role === "seller") filter.sellerId = req.user._id;
    if (req.user.role === "buyer") filter.buyerId = req.user._id;
    if (req.query.status) filter.status = req.query.status;
    const loans = await Loan.find(filter).populate("buyerId", "name email phone").populate("sellerId", "name phone").populate("productId", "name price").sort({ createdAt: -1 }).lean();
    const enrichedLoans = await Promise.all(loans.map(async (loan) => ({ ...loan, paymentSummary: await buildPaymentSummary(loan._id) })));
    res.json(enrichedLoans);
  })
);

router.get(
  "/:id/schedule",
  authenticate,
  asyncHandler(async (req, res) => {
    const loan = await Loan.findById(req.params.id);
    if (!loan) return res.status(404).json({ message: "Loan not found" });
    if (req.user.role === "buyer" && loan.buyerId.toString() !== req.user._id.toString()) return res.status(403).json({ message: "Forbidden" });
    if (req.user.role === "seller" && loan.sellerId.toString() !== req.user._id.toString()) return res.status(403).json({ message: "Forbidden" });
    const schedule = await EMISchedule.find({ loanId: loan._id }).populate("buyerId", "name phone email").populate("sellerId", "name phone email").sort({ installmentNo: 1 });
    res.json(schedule);
  })
);

router.get(
  "/:id/agreement",
  authenticate,
  asyncHandler(async (req, res) => {
    const loan = await Loan.findById(req.params.id);
    if (!loan) return res.status(404).json({ message: "Loan not found" });
    if (req.user.role === "buyer" && loan.buyerId.toString() !== req.user._id.toString()) return res.status(403).json({ message: "Forbidden" });
    if (req.user.role === "seller" && loan.sellerId.toString() !== req.user._id.toString()) return res.status(403).json({ message: "Forbidden" });
    if (!["active", "closed"].includes(loan.status)) return res.status(400).json({ message: "Agreement is available after loan approval" });
    const agreement = await ensureLoanAgreement(loan);
    res.json(agreement);
  })
);

router.patch(
  "/:id/agreement/accept",
  authenticate,
  asyncHandler(async (req, res) => {
    const loan = await Loan.findById(req.params.id);
    if (!loan) return res.status(404).json({ message: "Loan not found" });
    if (req.user.role === "buyer" && loan.buyerId.toString() !== req.user._id.toString()) return res.status(403).json({ message: "Forbidden" });
    if (req.user.role === "seller" && loan.sellerId.toString() !== req.user._id.toString()) return res.status(403).json({ message: "Forbidden" });
    if (!["buyer", "seller"].includes(req.user.role)) return res.status(403).json({ message: "Only buyer or seller can accept an agreement" });
    const agreement = await ensureLoanAgreement(loan);
    if (req.user.role === "buyer") agreement.acceptedByBuyerAt = new Date();
    if (req.user.role === "seller") agreement.acceptedBySellerAt = new Date();
    await agreement.save();
    await writeAudit(req.user._id, `loanAgreement.accepted.${req.user.role}`, "LoanAgreement", agreement._id, { loanId: loan._id });
    res.json(agreement);
  })
);

router.post(
  "/preview",
  authenticate,
  validateBody(loanPreviewSchema),
  asyncHandler(async (req, res) => {
    res.json(calculateSchedule(req.body));
  })
);

router.post(
  "/offline",
  authenticate,
  authorize("seller"),
  requireActiveSeller,
  validateBody(offlineLoanSchema),
  asyncHandler(async (req, res) => {
    const loan = await createLoanWithSchedule({ ...req.body, sellerId: req.user._id, source: "offline" }, req.user._id);
    res.status(201).json(loan);
  })
);

router.post(
  "/requests",
  authenticate,
  authorize("buyer"),
  requireVerified,
  validateBody(marketplaceLoanRequestSchema),
  asyncHandler(async (req, res) => {
    await assertBuyerReadyForEmi(req.user._id);
    const product = await Product.findOne({ _id: req.body.productId, sellerId: req.body.sellerId, status: "active" });
    if (!product) return res.status(404).json({ message: "Product not found" });
    if (!product.emiAvailable) return res.status(400).json({ message: "This product is not EMI available" });
    const selectedColor = resolveSelectedColor(product, req.body.selectedColorName);
    const downPayment = Number(req.body.downPayment || 0);
    const maxTenure = Number(product.emiMaxTenureMonths || 12);
    if (downPayment < Number(product.emiMinDownPayment || 0)) {
      return res.status(400).json({ message: `Minimum down payment for this product is BDT ${product.emiMinDownPayment || 0}` });
    }
    if (Number(req.body.tenureMonths) > maxTenure) {
      return res.status(400).json({ message: `Maximum EMI tenure for this product is ${maxTenure} months` });
    }
    const loan = await createLoanWithSchedule(
      {
        ...req.body,
        buyerId: req.user._id,
        source: "marketplace",
        principal: product.price,
        downPayment,
        interestRate: product.emiInterestRate || 0,
        interestType: product.emiInterestType || "flat",
        tenureMonths: Number(req.body.tenureMonths),
        selectedColorName: selectedColor.name,
        selectedColorHex: selectedColor.hex
      },
      req.user._id,
      { requested: true }
    );
    res.status(201).json(loan);
  })
);

router.get(
  "/seller/pending-kyc",
  authenticate,
  authorize("seller"),
  asyncHandler(async (req, res) => {
    const requestedLoans = await Loan.find({ sellerId: req.user._id, status: "requested" }).distinct("buyerId");
    const kyc = await KYCDocument.find({
      userId: { $in: requestedLoans },
      $or: [{ sellerId: req.user._id }, { sellerId: { $exists: false } }, { sellerId: null }],
      status: "pending"
    })
      .populate("userId", "name email phone")
      .sort({ createdAt: -1 });
    res.json(kyc.map(sanitizeKycDocument));
  })
);

router.post(
  "/seller/approve-kyc/:kycId",
  authenticate,
  authorize("seller"),
  asyncHandler(async (req, res) => {
    const kyc = await KYCDocument.findById(req.params.kycId);
    if (!kyc) return res.status(404).json({ message: "KYC not found" });
    const relatedLoan = await Loan.findOne({ sellerId: req.user._id, buyerId: kyc.userId, status: { $in: ["requested", "approved", "active"] } });
    if (!relatedLoan) return res.status(403).json({ message: "This buyer does not have an EMI request with your shop" });
    const review = await KYCReview.findOneAndUpdate(
      { kycDocumentId: kyc._id, reviewerRole: "seller", sellerId: req.user._id },
      { kycDocumentId: kyc._id, reviewerId: req.user._id, reviewerRole: "seller", sellerId: req.user._id, status: "approved", reviewedAt: new Date() },
      { upsert: true, new: true }
    );
    await writeAudit(req.user._id, "kyc.seller.approved", "KYCReview", review._id, { kycDocumentId: kyc._id });
    res.json({ ...sanitizeKycDocument(kyc), sellerReview: review });
  })
);

router.post(
  "/seller/reject-kyc/:kycId",
  authenticate,
  authorize("seller"),
  asyncHandler(async (req, res) => {
    const kyc = await KYCDocument.findById(req.params.kycId);
    if (!kyc) return res.status(404).json({ message: "KYC not found" });
    const relatedLoan = await Loan.findOne({ sellerId: req.user._id, buyerId: kyc.userId, status: { $in: ["requested", "approved", "active"] } });
    if (!relatedLoan) return res.status(403).json({ message: "This buyer does not have an EMI request with your shop" });
    const review = await KYCReview.findOneAndUpdate(
      { kycDocumentId: kyc._id, reviewerRole: "seller", sellerId: req.user._id },
      {
        kycDocumentId: kyc._id,
        reviewerId: req.user._id,
        reviewerRole: "seller",
        sellerId: req.user._id,
        status: "rejected",
        rejectionReason: req.body.reason || "Rejected",
        reviewedAt: new Date()
      },
      { upsert: true, new: true }
    );
    await writeAudit(req.user._id, "kyc.seller.rejected", "KYCReview", review._id, { kycDocumentId: kyc._id });
    res.json({ ...sanitizeKycDocument(kyc), sellerReview: review });
  })
);

function sanitizeKycDocument(doc) {
  const object = typeof doc.toObject === "function" ? doc.toObject() : doc;
  const id = object._id?.toString();
  return {
    ...object,
    files: (object.files || []).map((file, index) => ({
      originalName: file.originalName,
      filename: file.filename,
      mimetype: file.mimetype,
      size: file.size,
      downloadUrl: `/api/kyc/${id}/files/${index}`
    })),
    selfie: object.selfie
      ? {
          originalName: object.selfie.originalName,
          filename: object.selfie.filename,
          mimetype: object.selfie.mimetype,
          size: object.selfie.size,
          downloadUrl: `/api/kyc/${id}/files/selfie`
        }
      : undefined
  };
}

function resolveSelectedColor(product, requestedColorName) {
  const colors = normalizeProductColors(product);
  const selected = requestedColorName
    ? colors.find((color) => color.name.toLowerCase() === requestedColorName.toLowerCase())
    : colors[0];
  if (!selected) {
    const error = new Error("Please select a valid product color");
    error.status = 400;
    throw error;
  }
  return selected;
}

function normalizeProductColors(product) {
  const colors = (product.colors || []).filter((color) => color?.name);
  return colors.length ? colors : [{ name: "Default", hex: "#64748b" }];
}

async function buildPaymentSummary(loanId) {
  const payableRows = await EMISchedule.find({ loanId, status: { $in: ["pending", "partial", "overdue"] } }).sort({ dueDate: 1 }).lean();
  const balances = payableRows.map((row) => ({
    ...row,
    balance: Math.max(Number(row.amountDue || 0) + Number(row.lateFee || 0) - Number(row.amountPaid || 0), 0)
  }));
  return {
    nextDueAmount: balances[0]?.balance || 0,
    overdueAmount: balances.filter((row) => row.status === "overdue").reduce((sum, row) => sum + row.balance, 0),
    outstandingAmount: balances.reduce((sum, row) => sum + row.balance, 0),
    payableInstallments: balances.map((row) => ({
      _id: row._id,
      installmentNo: row.installmentNo,
      dueDate: row.dueDate,
      status: row.status,
      balance: row.balance
    }))
  };
}

router.patch(
  "/:id/approve",
  authenticate,
  authorize("seller"),
  requireActiveSeller,
  validateBody(rejectLoanSchema),
  asyncHandler(async (req, res) => {
    const loan = await Loan.findOne({ _id: req.params.id, sellerId: req.user._id, status: "requested" });
    if (!loan) return res.status(404).json({ message: "Loan request not found" });
    const kycDocs = await KYCDocument.find({ userId: loan.buyerId }).select("_id status").sort({ createdAt: -1 });
    const kycDocIds = kycDocs.map((doc) => doc._id);
    const adminApprovedKyc = kycDocs.some((doc) => doc.status === "approved");
    const sellerApprovedKyc = kycDocIds.length
      ? await KYCReview.exists({ kycDocumentId: { $in: kycDocIds }, reviewerRole: "seller", sellerId: req.user._id, status: "approved" })
      : null;
    if (!adminApprovedKyc && !sellerApprovedKyc) return res.status(400).json({ message: "Cannot approve EMI request. Buyer's KYC must be approved by admin or this seller first." });
    const approvedLoan = await approveLoanRequest(req.params.id, req.user._id, req.user._id);
    res.json(approvedLoan);
  })
);

router.patch(
  "/:id/reject",
  authenticate,
  authorize("seller"),
  requireActiveSeller,
  asyncHandler(async (req, res) => {
    const loan = await Loan.findOneAndUpdate(
      { _id: req.params.id, sellerId: req.user._id, status: "requested" },
      { status: "rejected", rejectionReason: req.body.reason || "Rejected by seller" },
      { new: true }
    );
    if (!loan) return res.status(404).json({ message: "Loan request not found" });
    await EMIApplication.findOneAndUpdate({ loanId: loan._id }, { status: "rejected", rejectionReason: req.body.reason || "Rejected by seller" });
    res.json(loan);
  })
);

module.exports = router;
