const fs = require("fs");
const express = require("express");
const KYCDocument = require("../models/KYCDocument");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, authorize } = require("../middleware/auth");
const { createUploader } = require("../middleware/upload");
const { uploadFile } = require("../utils/cloudinary");
const { writeAudit } = require("../services/auditService");

const router = express.Router();
const upload = createUploader("kyc");

router.post(
  "/",
  authenticate,
  upload.fields([
    { name: "documents", maxCount: 3 },
    { name: "selfie", maxCount: 1 }
  ]),
  asyncHandler(async (req, res) => {
    const documents = await Promise.all((req.files?.documents || []).map((file) => uploadAndBuild(file, `kyc/${req.user._id}/documents`)));
    const selfie = req.files?.selfie?.[0] ? await uploadAndBuild(req.files.selfie[0], `kyc/${req.user._id}/selfie`) : undefined;

    const doc = await KYCDocument.create({
      userId: req.user._id,
      type: req.body.type || "nid",
      files: documents,
      selfie
    });
    await writeAudit(req.user._id, "kyc.uploaded", "KYCDocument", doc._id);
    res.status(201).json(doc);
  })
);

router.get(
  "/mine",
  authenticate,
  asyncHandler(async (req, res) => {
    const docs = await KYCDocument.find({ userId: req.user._id }).sort({ createdAt: -1 });
    res.json(docs);
  })
);

router.get(
  "/pending",
  authenticate,
  authorize("seller", "admin"),
  asyncHandler(async (_req, res) => {
    const docs = await KYCDocument.find({ status: "pending" }).populate("userId", "name email phone").sort({ createdAt: -1 });
    res.json(docs);
  })
);

router.get(
  "/pending-for-seller",
  authenticate,
  authorize("seller"),
  asyncHandler(async (req, res) => {
    const Loan = require("../models/Loan");
    const requestedLoans = await Loan.find({ sellerId: req.user._id, status: "requested" }).distinct("buyerId");
    const docs = await KYCDocument.find({
      userId: { $in: requestedLoans },
      sellerId: req.user._id,
      status: "pending"
    })
      .populate("userId", "name email phone")
      .sort({ createdAt: -1 });
    res.json(docs);
  })
);

router.get(
  "/buyer-status/:buyerId",
  authenticate,
  authorize("seller"),
  asyncHandler(async (req, res) => {
    const doc = await KYCDocument.findOne({
      userId: req.params.buyerId,
      sellerId: req.user._id,
      status: "approved"
    });
    res.json({ approved: !!doc, document: doc });
  })
);

router.patch(
  "/:id/review-seller",
  authenticate,
  authorize("seller"),
  asyncHandler(async (req, res) => {
    const doc = await KYCDocument.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: "KYC document not found" });
    if (doc.sellerId && doc.sellerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not authorized to review this document" });
    }
    doc.status = req.body.status;
    doc.rejectionReason = req.body.rejectionReason;
    doc.reviewedBy = req.user._id;
    doc.reviewedAt = new Date();
    doc.sellerId = req.user._id;
    await doc.save();
    await writeAudit(req.user._id, `kyc.${doc.status}`, "KYCDocument", doc._id);
    res.json(doc);
  })
);

async function uploadAndBuild(file, folder) {
  const result = await uploadFile(file.path, folder);
  await fs.promises.unlink(file.path).catch(() => {});
  return {
    originalName: file.originalname,
    filename: file.filename,
    path: result.secure_url,
    publicId: result.public_id,
    mimetype: file.mimetype,
    size: file.size
  };
}

module.exports = router;
