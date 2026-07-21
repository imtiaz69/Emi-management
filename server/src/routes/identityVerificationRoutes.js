const crypto = require("crypto");
const express = require("express");
const IdentityVerificationSession = require("../models/IdentityVerificationSession");
const IdentityVerificationResult = require("../models/IdentityVerificationResult");
const BuyerProfile = require("../models/BuyerProfile");
const KYCDocument = require("../models/KYCDocument");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, authorize, requireActiveSeller } = require("../middleware/auth");
const { createRateLimiter, requireVerified } = require("../middleware/security");
const { validateBody, z } = require("../middleware/validate");
const { createSignedDirectUpload, deleteUploadedFile, getUploadedResource } = require("../utils/cloudinary");
const { hashToken, randomToken, tokenMatches } = require("../utils/identityCrypto");
const { sendProtectedFile } = require("../utils/fileDelivery");
const {
  canViewSession,
  createLinkedKyc,
  listCandidateBuyers,
  publicSession,
  readSensitive,
  userCanStartSession
} = require("../services/identityVerificationService");
const { writeAudit } = require("../services/auditService");
const { createNotification } = require("../services/notificationService");
const { getBuyerReadiness } = require("../services/buyerReadinessService");
const { runIdentityVerificationJobs } = require("../jobs/identityVerificationJob");

const router = express.Router();
const mobileLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 40, message: "Too many verification requests. Please wait." });
const createLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10, message: "Too many verification sessions created." });
const sessionTtlMs = () => Number(process.env.IDENTITY_SESSION_TTL_MINUTES || 10) * 60 * 1000;
const artifactRules = {
  front: { resourceType: "image", maxBytes: 6 * 1024 * 1024, formats: ["jpg", "jpeg", "png", "webp"] },
  back: { resourceType: "image", maxBytes: 6 * 1024 * 1024, formats: ["jpg", "jpeg", "png", "webp"] },
  liveness: { resourceType: null, maxBytes: 20 * 1024 * 1024, formats: ["webm", "mp4", "jpg", "jpeg", "png", "webp"] }
};

const createSchema = z.object({ buyerId: z.string().min(12).max(40) });
const tokenSchema = z.object({ token: z.string().min(32).max(200) });
const kindSchema = z.object({ kind: z.enum(["front", "back", "liveness"]), captureMode: z.enum(["video", "selfie"]).optional() });
const artifactSchema = z.object({
  kind: z.enum(["front", "back", "liveness"]),
  publicId: z.string().min(10).max(300),
  captureMode: z.enum(["video", "selfie"]).optional()
});
const manualDecisionSchema = z.object({
  decision: z.enum(["approve", "reject", "revoke", "recapture"]),
  reason: z.string().trim().min(3).max(500)
});

router.post(
  "/buyer/start",
  createLimiter,
  authenticate,
  authorize("buyer"),
  requireVerified,
  asyncHandler(async (req, res) => {
    const readiness = await getBuyerReadiness(req.user._id);
    if (readiness.hasKyc) {
      return res.status(409).json({
        message: "Your NID is already verified. Identity verification is now locked.",
        code: "IDENTITY_ALREADY_VERIFIED"
      });
    }
    const missingFields = readiness.missingFields;
    if (missingFields.length) {
      return res.status(400).json({
        message: `Complete your buyer profile before NID verification. Missing: ${missingFields.join(", ")}.`,
        missingFields
      });
    }
    const now = new Date();
    await IdentityVerificationSession.updateMany(
      { buyerId: req.user._id, verificationType: "nid_cross_check", status: { $in: ["CREATED", "CAPTURING"] } },
      { $set: { status: "CANCELLED", purgeAt: now }, $unset: { linkTokenHash: 1, uploadTokenHash: 1 } }
    );
    const uploadToken = randomToken();
    const session = await IdentityVerificationSession.create({
      buyerId: req.user._id,
      initiatedBy: req.user._id,
      initiatorRole: "buyer",
      verificationType: "nid_cross_check",
      uploadTokenHash: hashToken(uploadToken),
      expiresAt: new Date(Date.now() + sessionTtlMs()),
      status: "CAPTURING",
      captureMode: "document_only",
      challenge: []
    });
    await writeAudit(req.user._id, "identity.nid_session.created", "IdentityVerificationSession", session._id);
    res.status(201).json({ uploadToken, session: publicSession(session) });
  })
);

router.get(
  "/buyer/:id",
  authenticate,
  authorize("buyer"),
  requireVerified,
  asyncHandler(async (req, res) => {
    const session = await IdentityVerificationSession.findOne({
      _id: req.params.id,
      buyerId: req.user._id,
      verificationType: "nid_cross_check"
    }).select("+sensitivePayload");
    if (!session) return res.status(404).json({ message: "NID verification session not found" });
    const result = await IdentityVerificationResult.findOne({ sessionId: session._id });
    res.json(publicSession(session, result, readSensitive(session)));
  })
);

function authenticateAiService(req, res, next) {
  const provided = Buffer.from(req.headers["x-identity-service-key"] || "");
  const expected = Buffer.from(process.env.IDENTITY_AI_SERVICE_KEY || "");
  if (!expected.length || provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return res.status(401).json({ message: "Invalid identity service key" });
  }
  return next();
}

function mobileToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Verification ") ? header.slice("Verification ".length) : "";
}

async function authenticateMobile(req, res, next) {
  const token = mobileToken(req);
  if (!token) return res.status(401).json({ message: "Verification upload token required" });
  const session = await IdentityVerificationSession.findOne({ uploadTokenHash: hashToken(token) }).select("+uploadTokenHash");
  if (!session || !tokenMatches(token, session.uploadTokenHash)) return res.status(401).json({ message: "Invalid verification upload token" });
  if (session.expiresAt <= new Date()) {
    session.status = "EXPIRED";
    session.uploadTokenHash = undefined;
    await session.save();
    return res.status(410).json({ message: "Verification session expired" });
  }
  if (!["CAPTURING", "CREATED"].includes(session.status)) return res.status(409).json({ message: "Verification session no longer accepts uploads" });
  req.verificationSession = session;
  return next();
}

function challenge() {
  const actions = ["BLINK", "TURN_LEFT", "TURN_RIGHT"];
  for (let index = actions.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(index + 1);
    [actions[index], actions[swapIndex]] = [actions[swapIndex], actions[index]];
  }
  return actions;
}

function mobileUrl(token) {
  const base = (process.env.PUBLIC_CLIENT_URL || process.env.CLIENT_URL || "http://localhost:5173").split(",")[0].replace(/\/$/, "");
  return `${base}/verify/mobile#${token}`;
}

async function loadOfficerSession(req, res) {
  const session = await IdentityVerificationSession.findById(req.params.id)
    .select("+sensitivePayload")
    .populate("buyerId", "name email phone")
    .populate("initiatedBy", "name role");
  if (!session) {
    res.status(404).json({ message: "Verification session not found" });
    return null;
  }
  if (!canViewSession(req.user, session)) {
    res.status(403).json({ message: "Not authorized to view this session" });
    return null;
  }
  return session;
}

router.post(
  "/mobile/exchange",
  mobileLimiter,
  validateBody(tokenSchema),
  asyncHandler(async (req, res) => {
    const linkHash = hashToken(req.body.token);
    const uploadToken = randomToken();
    const session = await IdentityVerificationSession.findOneAndUpdate(
      { linkTokenHash: linkHash, linkUsedAt: null, expiresAt: { $gt: new Date() }, status: "CREATED" },
      {
        $set: { linkUsedAt: new Date(), uploadTokenHash: hashToken(uploadToken), status: "CAPTURING", expiresAt: new Date(Date.now() + sessionTtlMs()) },
        $unset: { linkTokenHash: 1 }
      },
      { new: true }
    );
    if (!session) return res.status(410).json({ message: "This verification link is invalid, expired, or already used" });
    res.json({ uploadToken, session: publicSession(session) });
  })
);

router.get(
  "/ai-assets/:sessionId/:kind",
  authenticateAiService,
  asyncHandler(async (req, res) => {
    if (!["front", "back", "liveness"].includes(req.params.kind)) return res.status(404).json({ message: "Identity artifact not found" });
    const session = await IdentityVerificationSession.findOne({
      _id: req.params.sessionId,
      status: { $in: ["QUEUED", "WAKING_AI", "PROCESSING"] },
      processingLeaseAt: { $gte: new Date(Date.now() - 10 * 60 * 1000) }
    });
    const artifact = session?.artifacts?.[req.params.kind];
    if (!artifact?.publicId || session.purgedAt) return res.status(404).json({ message: "Identity artifact not available" });
    return sendProtectedFile(res, {
      publicId: artifact.publicId,
      resourceType: artifact.resourceType,
      originalName: `${req.params.kind}.${artifact.format || "bin"}`,
      mimetype: artifact.resourceType === "video" ? `video/${artifact.format}` : `image/${artifact.format}`
    });
  })
);

router.get("/mobile/session", mobileLimiter, authenticateMobile, (req, res) => res.json(publicSession(req.verificationSession)));

router.post(
  "/mobile/upload-signature",
  mobileLimiter,
  authenticateMobile,
  validateBody(kindSchema),
  asyncHandler(async (req, res) => {
    const session = req.verificationSession;
    const { kind } = req.body;
    if (Number(session.captureAttempts?.[kind] || 0) >= 3) return res.status(429).json({ message: `Maximum ${kind} capture attempts exceeded` });
    const captureMode = kind === "liveness" ? req.body.captureMode || "video" : undefined;
    const resourceType = kind === "liveness" && captureMode === "video" ? "video" : "image";
    const publicId = `identity-verifications/${crypto.randomUUID()}`;
    session.pendingUploads[kind] = { publicId, resourceType, expiresAt: new Date(Date.now() + 5 * 60 * 1000) };
    if (captureMode) session.captureMode = captureMode;
    await session.save();
    res.json({ ...createSignedDirectUpload({ publicId, resourceType }), expiresAt: session.pendingUploads[kind].expiresAt });
  })
);

router.post(
  "/mobile/artifacts",
  mobileLimiter,
  authenticateMobile,
  validateBody(artifactSchema),
  asyncHandler(async (req, res) => {
    const session = req.verificationSession;
    const { kind, publicId } = req.body;
    const pending = session.pendingUploads?.[kind];
    if (!pending?.publicId || pending.publicId !== publicId || pending.expiresAt <= new Date()) {
      return res.status(400).json({ message: "The signed upload is missing or expired" });
    }
    const resource = await getUploadedResource(publicId, pending.resourceType).catch(() => null);
    if (!resource) return res.status(400).json({ message: "Uploaded Cloudinary asset could not be verified" });
    const rule = artifactRules[kind];
    const format = String(resource.format || "").toLowerCase();
    const expectedType = kind === "liveness" && req.body.captureMode === "selfie" ? "image" : pending.resourceType;
    const durationValid = expectedType !== "video" || (Number(resource.duration) >= 4 && Number(resource.duration) <= 12);
    if (resource.resource_type !== expectedType || Number(resource.bytes) > rule.maxBytes || !rule.formats.includes(format) || !durationValid) {
      await deleteUploadedFile({ publicId, resourceType: pending.resourceType });
      return res.status(400).json({ message: "The uploaded file does not satisfy identity capture requirements" });
    }
    if (session.artifacts?.[kind]?.publicId) await deleteUploadedFile(session.artifacts[kind]);
    session.artifacts[kind] = {
      publicId,
      resourceType: resource.resource_type,
      format,
      bytes: resource.bytes,
      width: resource.width,
      height: resource.height,
      duration: resource.duration,
      capturedAt: new Date()
    };
    session.pendingUploads[kind] = undefined;
    if (kind === "liveness") session.captureMode = req.body.captureMode || "video";
    session.captureAttempts[kind] = Number(session.captureAttempts[kind] || 0) + 1;
    await session.save();
    res.json(publicSession(session));
  })
);

router.post(
  "/mobile/complete",
  mobileLimiter,
  authenticateMobile,
  asyncHandler(async (req, res) => {
    const session = req.verificationSession;
    const documentOnly = session.verificationType === "nid_cross_check";
    if (documentOnly && (await getBuyerReadiness(session.buyerId)).hasKyc) {
      return res.status(409).json({
        message: "This buyer's NID is already verified. Another verification cannot be submitted.",
        code: "IDENTITY_ALREADY_VERIFIED"
      });
    }
    if (!session.artifacts?.front?.publicId || (!documentOnly && (!session.artifacts?.back?.publicId || !session.artifacts?.liveness?.publicId))) {
      return res.status(400).json({ message: documentOnly ? "The front NID image is required" : "Front, back, and live face captures are required" });
    }
    const requiredKinds = documentOnly ? ["front"] : ["front", "back", "liveness"];
    if (requiredKinds.some((kind) => Number(session.captureAttempts?.[kind] || 0) > 3)) {
      return res.status(429).json({ message: "Maximum capture attempts exceeded" });
    }
    await createLinkedKyc(session);
    session.status = "QUEUED";
    session.uploadTokenHash = undefined;
    session.nextAttemptAt = new Date();
    await session.save();
    runIdentityVerificationJobs().catch(() => {});
    res.status(202).json(publicSession(session));
  })
);

router.use(authenticate, authorize("seller", "admin"), requireActiveSeller);

router.get("/candidates", asyncHandler(async (req, res) => res.json(await listCandidateBuyers(req.user))));

router.post(
  "/",
  createLimiter,
  validateBody(createSchema),
  asyncHandler(async (req, res) => {
    const access = await userCanStartSession(req.user, req.body.buyerId);
    if (!access.allowed) return res.status(403).json({ message: access.message });
    const linkToken = randomToken();
    const session = await IdentityVerificationSession.create({
      buyerId: access.buyer._id,
      initiatedBy: req.user._id,
      initiatorRole: req.user.role,
      sellerId: req.user.role === "seller" ? req.user._id : undefined,
      linkTokenHash: hashToken(linkToken),
      expiresAt: new Date(Date.now() + sessionTtlMs()),
      challenge: challenge()
    });
    await writeAudit(req.user._id, "identity.session.created", "IdentityVerificationSession", session._id, { buyerId: access.buyer._id });
    res.status(201).json({ ...publicSession(session), mobileUrl: mobileUrl(linkToken) });
  })
);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const filter = req.user.role === "admin" ? {} : { initiatedBy: req.user._id };
    const sessions = await IdentityVerificationSession.find(filter).populate("buyerId", "name email phone").sort({ createdAt: -1 }).limit(100);
    const results = await IdentityVerificationResult.find({ sessionId: { $in: sessions.map((session) => session._id) } });
    const resultMap = new Map(results.map((result) => [result.sessionId.toString(), result]));
    res.json(sessions.map((session) => publicSession(session, resultMap.get(session._id.toString()))));
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const session = await loadOfficerSession(req, res);
    if (!session) return;
    const result = await IdentityVerificationResult.findOne({ sessionId: session._id });
    res.json(publicSession(session, result, readSensitive(session)));
  })
);

router.post(
  "/:id/renew",
  asyncHandler(async (req, res) => {
    const session = await loadOfficerSession(req, res);
    if (!session) return;
    if (session.artifacts?.front?.publicId || !["CREATED", "EXPIRED", "ERROR"].includes(session.status)) {
      return res.status(409).json({ message: "Only unused or expired sessions can be renewed" });
    }
    const token = randomToken();
    session.linkTokenHash = hashToken(token);
    session.uploadTokenHash = undefined;
    session.linkUsedAt = undefined;
    session.expiresAt = new Date(Date.now() + sessionTtlMs());
    session.status = "CREATED";
    session.lastError = undefined;
    session.processingAttempts = 0;
    session.purgeAt = undefined;
    session.purgedAt = undefined;
    await session.save();
    res.json({ ...publicSession(session), mobileUrl: mobileUrl(token) });
  })
);

router.post(
  "/:id/cancel",
  asyncHandler(async (req, res) => {
    const session = await loadOfficerSession(req, res);
    if (!session) return;
    if (["COMPLETED", "CANCELLED"].includes(session.status)) return res.status(409).json({ message: "Session cannot be cancelled" });
    session.status = "CANCELLED";
    session.linkTokenHash = undefined;
    session.uploadTokenHash = undefined;
    session.purgeAt = new Date(Date.now() + Number(process.env.IDENTITY_ARTIFACT_RETENTION_HOURS || 24) * 60 * 60 * 1000);
    await session.save();
    await writeAudit(req.user._id, "identity.session.cancelled", "IdentityVerificationSession", session._id);
    res.json(publicSession(session));
  })
);

router.post(
  "/:id/reprocess",
  asyncHandler(async (req, res) => {
    const session = await loadOfficerSession(req, res);
    if (!session) return;
    if (!session.artifacts?.front?.publicId || session.purgedAt) return res.status(409).json({ message: "Verification artifacts are no longer available" });
    session.status = "QUEUED";
    session.processingAttempts = 0;
    session.nextAttemptAt = new Date();
    session.lastError = undefined;
    await session.save();
    runIdentityVerificationJobs().catch(() => {});
    res.status(202).json(publicSession(session));
  })
);

router.patch(
  "/:id/manual-decision",
  authorize("admin"),
  validateBody(manualDecisionSchema),
  asyncHandler(async (req, res) => {
    const session = await loadOfficerSession(req, res);
    if (!session) return;
    const kyc = session.kycDocumentId ? await KYCDocument.findById(session.kycDocumentId) : null;
    if (!kyc) return res.status(409).json({ message: "This session does not have a linked KYC document" });
    const { decision, reason } = req.body;
    if (decision === "recapture") {
      await Promise.all(Object.values(session.artifacts?.toObject?.() || session.artifacts || {}).filter(Boolean).map(deleteUploadedFile));
      session.artifacts = {};
      session.captureAttempts = { front: 0, back: 0, liveness: 0 };
      session.processingAttempts = 0;
      session.status = "EXPIRED";
      session.purgedAt = new Date();
      await session.save();
      kyc.status = "pending";
      kyc.files = [];
    } else {
      kyc.status = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "pending";
      kyc.reviewedBy = req.user._id;
      kyc.reviewedAt = new Date();
      kyc.rejectionReason = decision === "reject" ? reason : undefined;
      if (decision === "revoke") {
        kyc.automatedVerification.revokedAt = new Date();
        kyc.automatedVerification.revokedBy = req.user._id;
        kyc.automatedVerification.revocationReason = reason;
      }
    }
    await kyc.save();
    await writeAudit(req.user._id, `identity.manual.${decision}`, "IdentityVerificationSession", session._id, { reason, kycDocumentId: kyc._id });
    await createNotification({
      userId: session.buyerId?._id || session.buyerId,
      title: "Identity review updated",
      messageType: `identity_manual_${decision}`,
      message: `An administrator updated your identity review: ${decision}.`,
      category: "kyc",
      severity: decision === "approve" ? "success" : "warning",
      actionUrl: "/buyer?tab=kyc",
      metadata: { sessionId: session._id, decision },
      dedupeKey: `identity:${session._id}:manual:${decision}:${Date.now()}`
    }).catch(() => {});
    res.json(publicSession(session, await IdentityVerificationResult.findOne({ sessionId: session._id })));
  })
);

router.get(
  "/:id/artifacts/:kind",
  asyncHandler(async (req, res) => {
    const session = await loadOfficerSession(req, res);
    if (!session) return;
    const artifact = session.artifacts?.[req.params.kind];
    if (!artifact?.publicId || session.purgedAt) return res.status(404).json({ message: "Verification artifact is no longer available" });
    return sendProtectedFile(res, {
      publicId: artifact.publicId,
      resourceType: artifact.resourceType,
      originalName: `identity-${req.params.kind}.${artifact.format || "bin"}`,
      mimetype: artifact.resourceType === "video" ? `video/${artifact.format}` : `image/${artifact.format}`
    });
  })
);

module.exports = router;
