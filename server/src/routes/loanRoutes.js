const express = require("express");
const Loan = require("../models/Loan");
const EMISchedule = require("../models/EMISchedule");
const KYCDocument = require("../models/KYCDocument");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, authorize, requireActiveSeller } = require("../middleware/auth");
const { calculateSchedule } = require("../services/emiService");
const { approveLoanRequest, createLoanWithSchedule } = require("../services/loanService");
const { writeAudit } = require("../services/auditService");

const router = express.Router();

router.get(
  "/",
  authenticate,
  asyncHandler(async (req, res) => {
    const filter = {};
    if (req.user.role === "seller") filter.sellerId = req.user._id;
    if (req.user.role === "buyer") filter.buyerId = req.user._id;
    if (req.query.status) filter.status = req.query.status;
    const loans = await Loan.find(filter).populate("buyerId", "name email phone").populate("sellerId", "name phone").populate("productId", "name price").sort({ createdAt: -1 });
    res.json(loans);
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
    const schedule = await EMISchedule.find({ loanId: loan._id }).sort({ installmentNo: 1 });
    res.json(schedule);
  })
);

router.post(
  "/preview",
  authenticate,
  asyncHandler(async (req, res) => {
    res.json(calculateSchedule(req.body));
  })
);

router.post(
  "/offline",
  authenticate,
  authorize("seller"),
  requireActiveSeller,
  asyncHandler(async (req, res) => {
    const loan = await createLoanWithSchedule({ ...req.body, sellerId: req.user._id, source: "offline" }, req.user._id);
    res.status(201).json(loan);
  })
);

router.post(
  "/requests",
  authenticate,
  authorize("buyer"),
  asyncHandler(async (req, res) => {
    const loan = await createLoanWithSchedule({ ...req.body, buyerId: req.user._id, source: "marketplace" }, req.user._id, { requested: true });
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
    res.json(kyc);
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
    kyc.status = "approved";
    kyc.reviewedBy = req.user._id;
    kyc.reviewedAt = new Date();
    kyc.sellerId = req.user._id;
    await kyc.save();
    await writeAudit(req.user._id, "kyc.approved", "KYCDocument", kyc._id);
    res.json(kyc);
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
    kyc.status = "rejected";
    kyc.rejectionReason = req.body.reason || "Rejected";
    kyc.reviewedBy = req.user._id;
    kyc.reviewedAt = new Date();
    kyc.sellerId = req.user._id;
    await kyc.save();
    await writeAudit(req.user._id, "kyc.rejected", "KYCDocument", kyc._id);
    res.json(kyc);
  })
);

router.patch(
  "/:id/approve",
  authenticate,
  authorize("seller"),
  requireActiveSeller,
  asyncHandler(async (req, res) => {
    const loan = await Loan.findOne({ _id: req.params.id, sellerId: req.user._id, status: "requested" });
    if (!loan) return res.status(404).json({ message: "Loan request not found" });
    const kyc = await KYCDocument.findOne({
      userId: loan.buyerId,
      status: "approved",
      $or: [{ sellerId: req.user._id }, { sellerId: { $exists: false } }, { sellerId: null }]
    });
    if (!kyc) return res.status(400).json({ message: "Cannot approve EMI request. Buyer's KYC must be approved first." });
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
    res.json(loan);
  })
);

module.exports = router;
