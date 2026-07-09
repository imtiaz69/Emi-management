const fs = require("fs");
const path = require("path");
const express = require("express");
const Loan = require("../models/Loan");
const KYCDocument = require("../models/KYCDocument");
const KYCReview = require("../models/KYCReview");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, authorize } = require("../middleware/auth");
const { requireVerified } = require("../middleware/security");
const { assertUploadedFilesSafe, createUploader } = require("../middleware/upload");
const { validateBody, z } = require("../middleware/validate");
const { getSignedDeliveryUrl, uploadFile } = require("../utils/cloudinary");
const { writeAudit } = require("../services/auditService");

const router = express.Router();
const upload = createUploader("kyc");
const uploadKycSchema = z.object({
  type: z.enum(["nid", "passport"]).optional().default("nid")
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
    { name: "documents", maxCount: 3 },
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
    res.json(docs.map(sanitizeKycDocument));
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
    res.json(docs.map(sanitizeKycDocument));
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

    const signedUrl = file.publicId && file.resourceType && getSignedDeliveryUrl(file.publicId, file.resourceType);
    if (signedUrl) {
      return res.redirect(signedUrl);
    }

    if (/^https?:\/\//i.test(file.path)) {
      return res.redirect(file.path);
    }

    const uploadsRoot = path.resolve(process.env.UPLOAD_DIR || "uploads");
    const absolutePath = path.resolve(file.path.replace(/^\/uploads\//, `${uploadsRoot}/`));
    if (!absolutePath.startsWith(uploadsRoot)) return res.status(400).json({ message: "Invalid KYC file path" });

    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(file.originalName || file.filename || "kyc-file")}"`);
    return res.sendFile(absolutePath);
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
    const relatedLoan = await Loan.exists({
      sellerId: user._id,
      buyerId: doc.userId,
      status: { $in: ["requested", "approved", "active"] }
    });
    return Boolean(relatedLoan);
  }
  return false;
}

function sanitizeKycDocument(doc) {
  const object = typeof doc.toObject === "function" ? doc.toObject() : doc;
  const id = object._id?.toString();
  return {
    ...object,
    files: (object.files || []).map((file, index) => sanitizeFile(file, `/api/kyc/${id}/files/${index}`)),
    selfie: object.selfie ? sanitizeFile(object.selfie, `/api/kyc/${id}/files/selfie`) : undefined
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
