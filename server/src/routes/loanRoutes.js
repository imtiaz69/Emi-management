const express = require("express");
const Loan = require("../models/Loan");
const EMISchedule = require("../models/EMISchedule");
const EMIApplication = require("../models/EMIApplication");
const KYCDocument = require("../models/KYCDocument");
const KYCReview = require("../models/KYCReview");
const LoanAgreement = require("../models/LoanAgreement");
const BuyerProfile = require("../models/BuyerProfile");
const Product = require("../models/Product");
const Review = require("../models/Review");
const SellerProfile = require("../models/SellerProfile");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, authorize, requireActiveSeller } = require("../middleware/auth");
const { requireVerified } = require("../middleware/security");
const { objectId, optionalObjectId, validateBody, z } = require("../middleware/validate");
const { calculateSchedule } = require("../services/emiService");
const { approveLoanRequest, createLoanWithSchedule } = require("../services/loanService");
const { writeAudit } = require("../services/auditService");
const { ensureLoanAgreement } = require("../services/agreementService");
const { createAgreementDocument } = require("../services/pdfDocumentService");
const { createNotification } = require("../services/notificationService");

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
    const loans = await Loan.find(filter).populate("buyerId", "name email phone").populate("sellerId", "name phone").populate("productId", "name price images").sort({ createdAt: -1 }).lean();
    const sellerSnapshots = await buildSellerSnapshots(loans);
    const enrichedLoans = await Promise.all(
      loans.map(async (loan) => ({
        ...loan,
        sellerStore: sellerSnapshots.get((loan.sellerId?._id || loan.sellerId)?.toString()) || null,
        paymentSummary: await buildPaymentSummary(loan._id)
      }))
    );
    res.json(enrichedLoans);
  })
);

router.get(
  "/:id",
  authenticate,
  asyncHandler(async (req, res) => {
    const loan = await Loan.findById(req.params.id)
      .populate("buyerId", "name email phone")
      .populate("sellerId", "name email phone")
      .populate("productId", "name price images")
      .populate("orderId", "orderNo shippingAddress");
    if (!loan) return res.status(404).json({ message: "Loan not found" });
    if (req.user.role === "buyer" && loan.buyerId?._id?.toString() !== req.user._id.toString()) return res.status(403).json({ message: "Forbidden" });
    if (req.user.role === "seller" && loan.sellerId?._id?.toString() !== req.user._id.toString()) return res.status(403).json({ message: "Forbidden" });
    res.json({ ...loan.toObject(), paymentSummary: await buildPaymentSummary(loan._id) });
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
  "/:id/agreement/pdf",
  authenticate,
  asyncHandler(async (req, res) => {
    const loan = await Loan.findById(req.params.id)
      .populate("buyerId", "name email phone")
      .populate("sellerId", "name email phone")
      .populate("productId", "name price")
      .populate("orderId", "orderNo shippingAddress");
    if (!loan) return res.status(404).json({ message: "Loan not found" });
    if (req.user.role === "buyer" && loan.buyerId?._id?.toString() !== req.user._id.toString()) return res.status(403).json({ message: "Forbidden" });
    if (req.user.role === "seller" && loan.sellerId?._id?.toString() !== req.user._id.toString()) return res.status(403).json({ message: "Forbidden" });
    if (!["active", "closed"].includes(loan.status)) return res.status(400).json({ message: "Agreement is available after the down payment and loan activation" });

    const [agreement, schedules, buyerProfile, sellerProfile] = await Promise.all([
      ensureLoanAgreement(loan),
      EMISchedule.find({ loanId: loan._id }).sort({ installmentNo: 1 }).lean(),
      BuyerProfile.findOne({ userId: loan.buyerId._id }).select("address").lean(),
      SellerProfile.findOne({ userId: loan.sellerId._id }).select("shopName ownerName address businessType").lean()
    ]);
    const fileName = `FinanceLend-agreement-${String(agreement.agreementNo).replace(/[^a-zA-Z0-9_-]/g, "")}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Cache-Control", "private, no-store");
    const document = createAgreementDocument({ loan, agreement, schedules, buyerProfile, sellerProfile });
    document.pipe(res);
    document.end();
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
  asyncHandler(async (req, res) => {
    res.status(410).json({
      message: "Direct EMI requests are no longer supported. Add the product to cart and complete checkout so delivery details and the order remain linked."
    });
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
    await createNotification({
      userId: kyc.userId,
      title: "KYC approved by seller",
      messageType: "kyc_seller_approved",
      message: "The seller approved your identity documents for this EMI request.",
      category: "kyc",
      severity: "success",
      actionUrl: "/buyer?tab=kyc",
      metadata: { kycDocumentId: kyc._id, sellerId: req.user._id },
      dedupeKey: `kyc:${kyc._id}:seller:${req.user._id}:approved`
    }).catch((error) => console.error("Unable to create KYC notification", error));
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
    await createNotification({
      userId: kyc.userId,
      title: "KYC needs attention",
      messageType: "kyc_seller_rejected",
      message: `The seller could not approve your documents: ${review.rejectionReason}.`,
      category: "kyc",
      severity: "critical",
      actionUrl: "/buyer?tab=kyc",
      metadata: { kycDocumentId: kyc._id, sellerId: req.user._id, reason: review.rejectionReason },
      dedupeKey: `kyc:${kyc._id}:seller:${req.user._id}:rejected`
    }).catch((error) => console.error("Unable to create KYC notification", error));
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

async function buildSellerSnapshots(loans) {
  const sellerIds = [...new Set(loans.map((loan) => (loan.sellerId?._id || loan.sellerId)?.toString()).filter(Boolean))];
  if (!sellerIds.length) return new Map();

  const [profiles, products] = await Promise.all([
    SellerProfile.find({ userId: { $in: sellerIds } }).select("userId shopName businessType address approvedAt").lean(),
    Product.find({ sellerId: { $in: sellerIds }, status: "active", approvalStatus: "approved" }).select("_id sellerId").lean()
  ]);
  const productSeller = new Map(products.map((product) => [product._id.toString(), product.sellerId.toString()]));
  const reviews = products.length
    ? await Review.find({ productId: { $in: products.map((product) => product._id) }, status: "published" }).select("productId rating").lean()
    : [];
  const ratings = new Map();
  for (const review of reviews) {
    const sellerId = productSeller.get(review.productId.toString());
    if (!sellerId) continue;
    const current = ratings.get(sellerId) || { total: 0, count: 0 };
    current.total += Number(review.rating || 0);
    current.count += 1;
    ratings.set(sellerId, current);
  }

  return new Map(
    sellerIds.map((sellerId) => {
      const profile = profiles.find((row) => row.userId.toString() === sellerId);
      const rating = ratings.get(sellerId) || { total: 0, count: 0 };
      return [
        sellerId,
        {
          shopName: profile?.shopName || "",
          businessType: profile?.businessType || "",
          address: profile?.address || "",
          approvedAt: profile?.approvedAt,
          averageRating: rating.count ? Number((rating.total / rating.count).toFixed(1)) : 0,
          reviewCount: rating.count
        }
      ];
    })
  );
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
    const awaitingDownPayment = Number(approvedLoan.downPayment || 0) > 0;
    await createNotification({
      userId: approvedLoan.buyerId?._id || approvedLoan.buyerId,
      loanId: approvedLoan._id,
      title: "EMI request approved",
      messageType: "emi_request_approved",
      message: awaitingDownPayment
        ? `Your EMI request was approved. Pay the down payment of BDT ${Number(approvedLoan.downPayment).toLocaleString("en-BD")} to activate delivery.`
        : "Your EMI request was approved and the loan is now active.",
      category: "loan",
      severity: "success",
      actionUrl: `/loans/${approvedLoan._id}`,
      metadata: { status: approvedLoan.status, downPayment: approvedLoan.downPayment },
      dedupeKey: `loan:${approvedLoan._id}:approved`
    }).catch((error) => console.error("Unable to create loan approval notification", error));
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
    await createNotification({
      userId: loan.buyerId,
      loanId: loan._id,
      title: "EMI request declined",
      messageType: "emi_request_rejected",
      message: `Your EMI request was declined: ${loan.rejectionReason}.`,
      category: "loan",
      severity: "critical",
      actionUrl: "/buyer?tab=applications",
      metadata: { reason: loan.rejectionReason },
      dedupeKey: `loan:${loan._id}:rejected`
    }).catch((error) => console.error("Unable to create loan rejection notification", error));
    res.json(loan);
  })
);

module.exports = router;
