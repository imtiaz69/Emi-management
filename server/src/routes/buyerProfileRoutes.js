const express = require("express");
const fs = require("fs");
const BuyerProfile = require("../models/BuyerProfile");
const KYCDocument = require("../models/KYCDocument");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, authorize } = require("../middleware/auth");
const { assertUploadedFilesSafe, createUploader } = require("../middleware/upload");
const { validateBody, z } = require("../middleware/validate");
const { getBuyerReadiness } = require("../services/buyerReadinessService");
const { deleteUploadedFile, uploadFile } = require("../utils/cloudinary");
const { sendProtectedFile } = require("../utils/fileDelivery");
const { writeAudit } = require("../services/auditService");

const router = express.Router();
const upload = createUploader("profiles");

const buyerProfileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().min(3).max(300),
  nidNumber: z.string().trim().min(5).max(40),
  dateOfBirth: z.string().date(),
  emergencyContactName: z.string().trim().max(120).optional().default(""),
  emergencyContactPhone: z.string().trim().min(5).max(30),
  monthlyIncome: z.coerce.number().min(1),
  occupation: z.string().trim().min(2).max(120),
  employmentType: z.enum(["salaried", "self_employed", "business_owner", "student", "unemployed", "other"])
});

router.get(
  "/profile",
  authenticate,
  authorize("buyer"),
  asyncHandler(async (req, res) => {
    const profile = await BuyerProfile.findOneAndUpdate({ userId: req.user._id }, { $setOnInsert: { userId: req.user._id } }, { new: true, upsert: true });
    const readiness = await getBuyerReadiness(req.user._id);
    res.json({ accountName: req.user.name, profile: sanitizeBuyerProfile(profile), readiness: { ready: readiness.ready, missingFields: readiness.missingFields, hasKyc: readiness.hasKyc } });
  })
);

router.patch(
  "/profile",
  authenticate,
  authorize("buyer"),
  validateBody(buyerProfileSchema),
  asyncHandler(async (req, res) => {
    const previous = await BuyerProfile.findOne({ userId: req.user._id }).select("nidNumber dateOfBirth");
    const normalizedPreviousName = String(req.user.name || "").trim().replace(/\s+/g, " ").toUpperCase();
    const normalizedNextName = String(req.body.name || "").trim().replace(/\s+/g, " ").toUpperCase();
    const identityChanged = previous && (
      String(previous.nidNumber || "").trim() !== String(req.body.nidNumber || "").trim()
      || String(previous.dateOfBirth || "").trim() !== String(req.body.dateOfBirth || "").trim()
      || normalizedPreviousName !== normalizedNextName
    );
    const { name, ...profileData } = req.body;
    const [profile] = await Promise.all([
      BuyerProfile.findOneAndUpdate({ userId: req.user._id }, { ...profileData, userId: req.user._id }, { new: true, upsert: true }),
      req.user.updateOne({ name })
    ]);
    if (identityChanged) {
      await KYCDocument.updateMany(
        { userId: req.user._id, type: "nid", verificationMethod: "identity_cross_validation", status: "approved" },
        { $set: { status: "rejected", rejectionReason: "Profile identity information changed after verification. Please verify the NID again." } }
      );
    }
    const readiness = await getBuyerReadiness(req.user._id);
    res.json({ accountName: name, profile: sanitizeBuyerProfile(profile), readiness: { ready: readiness.ready, missingFields: readiness.missingFields, hasKyc: readiness.hasKyc } });
  })
);

router.post(
  "/profile-photo",
  authenticate,
  authorize("buyer"),
  upload.single("profilePhoto"),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "Please upload a profile picture" });
    await assertUploadedFilesSafe([req.file]);

    const currentProfile = await BuyerProfile.findOneAndUpdate(
      { userId: req.user._id },
      { $setOnInsert: { userId: req.user._id } },
      { new: true, upsert: true }
    );
    const previousPhoto = currentProfile.profilePhoto?.path ? currentProfile.profilePhoto.toObject?.() || currentProfile.profilePhoto : null;
    currentProfile.profilePhoto = await uploadAndBuild(req.file, `profiles/${req.user._id}`);
    await currentProfile.save();
    if (previousPhoto) await deleteUploadedFile(previousPhoto);
    await writeAudit(req.user._id, "buyer.profile_photo.updated", "BuyerProfile", currentProfile._id);

    const readiness = await getBuyerReadiness(req.user._id);
    res.json({ accountName: req.user.name, profile: sanitizeBuyerProfile(currentProfile), readiness: { ready: readiness.ready, missingFields: readiness.missingFields, hasKyc: readiness.hasKyc } });
  })
);

router.get(
  "/profile-photo/:buyerId",
  authenticate,
  asyncHandler(async (req, res) => {
    if (!["seller", "admin"].includes(req.user.role) && req.user._id.toString() !== req.params.buyerId) {
      return res.status(403).json({ message: "Not authorized to view this buyer profile picture" });
    }

    const profile = await BuyerProfile.findOne({ userId: req.params.buyerId }).select("profilePhoto userId");
    const file = profile?.profilePhoto;
    if (!file?.path) return res.status(404).json({ message: "Buyer profile picture not found" });
    return sendProtectedFile(res, file, { defaultName: "buyer-profile-picture", invalidPathMessage: "Invalid profile picture path" });
  })
);

function sanitizeBuyerProfile(profile) {
  const object = typeof profile?.toObject === "function" ? profile.toObject() : profile || {};
  const userId = object.userId?.toString?.() || object.userId;
  const { profilePhoto, ...rest } = object;
  return {
    ...rest,
    profilePhoto: profilePhoto?.path ? sanitizeFile(profilePhoto, `/api/buyer/profile-photo/${userId}`) : undefined
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
