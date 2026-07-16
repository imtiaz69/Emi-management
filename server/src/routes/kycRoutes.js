const fs = require("fs");
const express = require("express");
const BuyerProfile = require("../models/BuyerProfile");
const Loan = require("../models/Loan");
const Order = require("../models/Order");
const KYCDocument = require("../models/KYCDocument");
const KYCReview = require("../models/KYCReview");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, authorize } = require("../middleware/auth");
const { requireVerified } = require("../middleware/security");
const { assertUploadedFilesSafe, createUploader } = require("../middleware/upload");
const { validateBody, z } = require("../middleware/validate");
const { uploadFile } = require("../utils/cloudinary");
const { sendProtectedFile } = require("../utils/fileDelivery");
const { writeAudit } = require("../services/auditService");

const router = express.Router();
const upload = createUploader("kyc");
const { KYC_DOCUMENT_TYPES } = KYCDocument;
const uploadKycSchema = z.object({
  type: z.enum(KYC_DOCUMENT_TYPES).optional().default("nid")
});
const kycReviewSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  rejectionReason: z.string().trim().max(500).optional().default("")
});

router.post(
  "/",
  authenticate,
  requireVerified,
  upload.fields([
    { name: "documents", maxCount: 10 },
    { name: "selfie", maxCount: 1 }
  ]),
  validateBody(uploadKycSchema),
  asyncHandler(async (req, res) => {
    await assertUploadedFilesSafe(req.files || {});
    const documents = await Promise.all((req.files?.documents || []).map((file) => uploadAndBuild(file, `kyc/${req.user._id}/documents`)));
    const selfie = req.files?.selfie?.[0] ? await uploadAndBuild(req.files.selfie[0], `kyc/${req.user._id}/selfie`) : undefined;

    const doc = await KYCDocument.create({
      userId: req.user._id,
      type: req.body.type,
      files: documents,
      selfie
    });
    await writeAudit(req.user._id, "kyc.uploaded", "KYCDocument", doc._id);
    res.status(201).json(sanitizeKycDocument(doc));
  })
);

router.get(
  "/mine",
  authenticate,
  asyncHandler(async (req, res) => {
    const docs = await KYCDocument.find({ userId: req.user._id }).sort({ createdAt: -1 });
    res.json(docs.map(sanitizeKycDocument));
  })
);

router.get(
  "/pending",
  authenticate,
  authorize("seller", "admin"),
  asyncHandler(async (_req, res) => {
    const docs = await KYCDocument.find({ status: "pending" }).populate("userId", "name email phone").sort({ createdAt: -1 });
    res.json(await sanitizeKycDocumentsWithProfiles(docs));
  })
);

router.get(
  "/pending-for-seller",
  authenticate,
  authorize("seller"),
  asyncHandler(async (req, res) => {
    const requestedLoans = await Loan.find({ sellerId: req.user._id, status: "requested" }).distinct("buyerId");
    const reviewedIds = await KYCReview.find({ sellerId: req.user._id, reviewerRole: "seller" }).distinct("kycDocumentId");
    const docs = await KYCDocument.find({
      userId: { $in: requestedLoans },
      _id: { $nin: reviewedIds },
      $or: [{ sellerId: req.user._id }, { sellerId: { $exists: false } }, { sellerId: null }],
      status: { $in: ["pending", "approved"] }
    })
      .populate("userId", "name email phone")
      .sort({ createdAt: -1 });
    res.json(await sanitizeKycDocumentsWithProfiles(docs));
  })
);

router.get(
  "/buyer-status/:buyerId",
  authenticate,
  authorize("seller"),
  asyncHandler(async (req, res) => {
    const doc = await KYCDocument.findOne({ userId: req.params.buyerId }).sort({ createdAt: -1 });
    const sellerReview = doc
      ? await KYCReview.findOne({ kycDocumentId: doc._id, reviewerRole: "seller", sellerId: req.user._id }).sort({ reviewedAt: -1 })
      : null;
    res.json({
      approved: doc?.status === "approved" || sellerReview?.status === "approved",
      document: doc ? sanitizeKycDocument(doc) : null,
      sellerReview
    });
  })
);

router.get(
  "/:id/files/:fileId",
  authenticate,
  asyncHandler(async (req, res) => {
    const doc = await KYCDocument.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: "KYC document not found" });
    const allowed = await canAccessKyc(req.user, doc);
    if (!allowed) return res.status(403).json({ message: "Not authorized to access this KYC file" });

    const file = req.params.fileId === "selfie" ? doc.selfie : doc.files[Number(req.params.fileId)];
    if (!file?.path) return res.status(404).json({ message: "KYC file not found" });

    return sendProtectedFile(res, file, { defaultName: "kyc-file", invalidPathMessage: "Invalid KYC file path" });
  })
);

router.patch(
  "/:id/review",
  authenticate,
  authorize("admin"),
  validateBody(kycReviewSchema),
  asyncHandler(async (req, res) => {
    const doc = await KYCDocument.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: "KYC document not found" });
    doc.status = req.body.status;
    doc.rejectionReason = req.body.status === "rejected" ? req.body.rejectionReason || "Rejected by admin" : undefined;
    doc.reviewedBy = req.user._id;
    doc.reviewedAt = new Date();
    await doc.save();
    await KYCReview.findOneAndUpdate(
      { kycDocumentId: doc._id, reviewerRole: "admin" },
      {
        reviewerId: req.user._id,
        reviewerRole: "admin",
        status: req.body.status,
        rejectionReason: req.body.status === "rejected" ? doc.rejectionReason : undefined,
        reviewedAt: new Date()
      },
      { upsert: true, new: true }
    );
    await writeAudit(req.user._id, `kyc.admin.${doc.status}`, "KYCDocument", doc._id);
    res.json(sanitizeKycDocument(doc));
  })
);

router.patch(
  "/:id/review-seller",
  authenticate,
  authorize("seller"),
  validateBody(kycReviewSchema),
  asyncHandler(async (req, res) => {
    const doc = await KYCDocument.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: "KYC document not found" });
    const relatedLoan = await Loan.findOne({
      sellerId: req.user._id,
      buyerId: doc.userId,
      status: { $in: ["requested", "approved", "active"] }
    });
    if (!relatedLoan) {
      return res.status(403).json({ message: "This buyer does not have an EMI request with your shop" });
    }
    const review = await KYCReview.findOneAndUpdate(
      { kycDocumentId: doc._id, reviewerRole: "seller", sellerId: req.user._id },
      {
        kycDocumentId: doc._id,
        reviewerId: req.user._id,
        reviewerRole: "seller",
        sellerId: req.user._id,
        status: req.body.status,
        rejectionReason: req.body.status === "rejected" ? req.body.rejectionReason || "Rejected by seller" : undefined,
        reviewedAt: new Date()
      },
      { upsert: true, new: true }
    );
    await writeAudit(req.user._id, `kyc.seller.${review.status}`, "KYCReview", review._id, { kycDocumentId: doc._id });
    res.json({ ...sanitizeKycDocument(doc), sellerReview: review });
  })
);

async function canAccessKyc(user, doc) {
  if (user.role === "admin") return true;
  if (user.role === "buyer") return doc.userId.toString() === user._id.toString();
  if (user.role === "seller") {
    if (doc.sellerId?.toString() === user._id.toString()) return true;
    const [relatedLoan, relatedOrder] = await Promise.all([
      Loan.exists({
        sellerId: user._id,
        buyerId: doc.userId,
        status: { $in: ["requested", "approved", "active"] }
      }),
      Order.exists({ sellerIds: user._id, buyerId: doc.userId })
    ]);
    return Boolean(relatedLoan || relatedOrder);
  }
  return false;
}

async function sanitizeKycDocumentsWithProfiles(docs) {
  const userIds = [...new Set(docs.map((doc) => getKycUserId(doc)).filter(Boolean))];
  const profiles = await BuyerProfile.find({ userId: { $in: userIds } }).select("userId profilePhoto riskScore riskCategory occupation monthlyIncome").lean();
  const profileMap = new Map(profiles.map((profile) => [profile.userId.toString(), profile]));
  return docs.map((doc) => sanitizeKycDocument(doc, profileMap.get(getKycUserId(doc))));
}

function sanitizeKycDocument(doc, buyerProfile) {
  const object = typeof doc.toObject === "function" ? doc.toObject() : doc;
  const id = object._id?.toString();
  return {
    ...object,
    files: (object.files || []).map((file, index) => sanitizeFile(file, `/api/kyc/${id}/files/${index}`)),
    selfie: object.selfie ? sanitizeFile(object.selfie, `/api/kyc/${id}/files/selfie`) : undefined,
    buyerProfile: buyerProfile ? sanitizeBuyerProfileSummary(buyerProfile) : undefined
  };
}

function getKycUserId(doc) {
  const object = typeof doc.toObject === "function" ? doc.toObject() : doc;
  return object.userId?._id?.toString?.() || object.userId?.toString?.() || "";
}

function sanitizeBuyerProfileSummary(profile) {
  const userId = profile.userId?.toString?.() || profile.userId;
  return {
    riskScore: profile.riskScore,
    riskCategory: profile.riskCategory,
    occupation: profile.occupation,
    monthlyIncome: profile.monthlyIncome,
    profilePhoto: profile.profilePhoto?.path ? sanitizeFile(profile.profilePhoto, `/api/buyer/profile-photo/${userId}`) : undefined
  };
}

function sanitizeFile(file, downloadUrl) {
  return {
    originalName: file.originalName,
    filename: file.filename,
    mimetype: file.mimetype,
    size: file.size,
    downloadUrl
  };
}

async function uploadAndBuild(file, folder) {
  const result = await uploadFile(file.path, folder, { private: true });
  if (!result.local) {
    await fs.promises.unlink(file.path).catch(() => {});
  }
  return {
    originalName: file.originalname,
    filename: file.filename,
    path: result.secure_url,
    publicId: result.public_id,
    resourceType: result.resource_type,
    mimetype: file.mimetype,
    size: file.size
  };
}

module.exports = router;
