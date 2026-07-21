const IdentityVerificationSession = require("../models/IdentityVerificationSession");
const IdentityVerificationResult = require("../models/IdentityVerificationResult");
const BuyerProfile = require("../models/BuyerProfile");
const KYCDocument = require("../models/KYCDocument");
const Loan = require("../models/Loan");
const Order = require("../models/Order");
const User = require("../models/User");
const { createNotification, notifyRole } = require("./notificationService");
const { writeAudit } = require("./auditService");
const { decryptJson, encryptJson } = require("../utils/identityCrypto");
const { deleteUploadedFile, getSignedDeliveryUrl } = require("../utils/cloudinary");

const FINAL_SESSION_STATUSES = new Set(["COMPLETED", "EXPIRED", "CANCELLED"]);

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function thresholds() {
  return {
    nameMatch: numberEnv("IDENTITY_NAME_MATCH_THRESHOLD", 0.9),
    nameBorderline: numberEnv("IDENTITY_NAME_BORDERLINE_THRESHOLD", 0.78),
    faceMatch: numberEnv("IDENTITY_FACE_MATCH_THRESHOLD", 0.363),
    faceBorderline: numberEnv("IDENTITY_FACE_BORDERLINE_THRESHOLD", 0.3)
  };
}

function normalizeText(value = "") {
  const bengaliDigits = "০১২৩৪৫৬৭৮৯";
  return String(value)
    .normalize("NFKC")
    .replace(/[০-৯]/g, (digit) => String(bengaliDigits.indexOf(digit)))
    .toUpperCase()
    .replace(/[^A-Z0-9\u0980-\u09FF]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeNid(value) {
  return normalizeText(value).replace(/\D/g, "");
}

function normalizeDate(value) {
  if (!value) return "";
  const text = normalizeText(value).replace(/\s/g, "-");
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const dayFirst = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (dayFirst) return `${dayFirst[3]}-${dayFirst[2].padStart(2, "0")}-${dayFirst[1].padStart(2, "0")}`;
  return text;
}

function maskNid(value = "") {
  const normalized = normalizeNid(value);
  return normalized ? `${"*".repeat(Math.max(0, normalized.length - 4))}${normalized.slice(-4)}` : "";
}

function maskName(value = "") {
  return normalizeText(value).split(" ").filter(Boolean).map((part) => `${part[0]}${"*".repeat(Math.max(1, part.length - 1))}`).join(" ");
}

function maskDate(value = "") {
  const normalized = normalizeDate(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? `${normalized.slice(0, 4)}-**-**` : "";
}

function statusCheck(status, detail) {
  return { status, ...(detail ? { detail } : {}) };
}

function buildDecision(observation = {}, captureMode = "video") {
  const limits = thresholds();
  const front = observation.ocr?.fields || {};
  const qr = observation.qr?.fields || {};
  const profile = observation.profileFields || {};
  const qrStatus = observation.qr?.status || "QR_DATA_UNREADABLE";
  const frontNid = normalizeNid(front.nidNumber);
  const qrNid = normalizeNid(qr.nidNumber);
  const frontDob = normalizeDate(front.dateOfBirth);
  const qrDob = normalizeDate(qr.dateOfBirth);
  const nameSimilarity = Number(observation.comparisons?.nameSimilarity || 0);
  const faceSimilarity = Number(observation.face?.similarity || 0);

  const nidStatus = frontNid && qrNid ? (frontNid === qrNid ? "PASS" : "FAIL") : "INCONCLUSIVE";
  const dobStatus = frontDob && qrDob ? (frontDob === qrDob ? "PASS" : "FAIL") : "INCONCLUSIVE";
  const nameStatus = !front.name || !qr.name
    ? "INCONCLUSIVE"
    : nameSimilarity >= limits.nameMatch
      ? "PASS"
      : nameSimilarity >= limits.nameBorderline
        ? "INCONCLUSIVE"
        : "FAIL";
  const documentOnly = captureMode === "document_only";
  const profileNid = normalizeNid(profile.nidNumber);
  const profileDob = normalizeDate(profile.dateOfBirth);
  const profileName = normalizeText(profile.name);
  const profileNidStatus = !documentOnly ? "NOT_AVAILABLE" : profileNid && frontNid ? (profileNid === frontNid ? "PASS" : "FAIL") : "INCONCLUSIVE";
  const profileDobStatus = !documentOnly ? "NOT_AVAILABLE" : profileDob && frontDob ? (profileDob === frontDob ? "PASS" : "FAIL") : "INCONCLUSIVE";
  const profileNameStatus = !documentOnly ? "NOT_AVAILABLE" : profileName && front.name
    ? (profileName === normalizeText(front.name) ? "PASS" : "FAIL")
    : "INCONCLUSIVE";
  const faceStatus = documentOnly
    ? "NOT_AVAILABLE"
    : !observation.face?.detected || !observation.face?.qualityAcceptable
    ? "INCONCLUSIVE"
    : faceSimilarity >= limits.faceMatch
      ? "PASS"
      : faceSimilarity >= limits.faceBorderline
        ? "INCONCLUSIVE"
        : "FAIL";
  const livenessStatus = documentOnly || captureMode === "selfie" ? "NOT_AVAILABLE" : observation.liveness?.status || "INCONCLUSIVE";

  const qrNotRequiredDetail = documentOnly ? "Not required for profile-to-front verification." : undefined;
  const checks = {
    frontOcr: statusCheck(observation.ocr?.status === "COMPLETED" ? "PASS" : "INCONCLUSIVE"),
    qrDecoded: statusCheck(documentOnly ? "NOT_AVAILABLE" : qrStatus === "DECODED" ? "PASS" : "INCONCLUSIVE", qrNotRequiredDetail || qrStatus),
    nidNumberMatch: statusCheck(documentOnly ? "NOT_AVAILABLE" : nidStatus, qrNotRequiredDetail),
    nameMatch: statusCheck(documentOnly ? "NOT_AVAILABLE" : nameStatus, qrNotRequiredDetail),
    dateOfBirthMatch: statusCheck(documentOnly ? "NOT_AVAILABLE" : dobStatus, qrNotRequiredDetail),
    profileNidNumberMatch: statusCheck(profileNidStatus),
    profileNameMatch: statusCheck(profileNameStatus),
    profileDateOfBirthMatch: statusCheck(profileDobStatus),
    faceDetected: statusCheck(documentOnly ? "NOT_AVAILABLE" : observation.face?.detected ? "PASS" : "FAIL"),
    faceQuality: statusCheck(documentOnly ? "NOT_AVAILABLE" : observation.face?.qualityAcceptable ? "PASS" : "INCONCLUSIVE"),
    faceMatch: statusCheck(faceStatus),
    liveness: statusCheck(livenessStatus)
  };

  const explicitFailure = (documentOnly
    ? [profileNidStatus, profileDobStatus, profileNameStatus]
    : [nidStatus, dobStatus, nameStatus, faceStatus, livenessStatus]).includes("FAIL");
  const profilePass = !documentOnly || [profileNidStatus, profileDobStatus, profileNameStatus].every((status) => status === "PASS");
  const profileDocumentPass = observation.ocr?.status === "COMPLETED" && profilePass;
  const frontQrDocumentPass = qrStatus === "DECODED" && nidStatus === "PASS" && dobStatus === "PASS" && nameStatus === "PASS";
  const fullPass = frontQrDocumentPass && faceStatus === "PASS" && livenessStatus === "PASS";
  const partialPass = frontQrDocumentPass && faceStatus === "PASS" && captureMode === "selfie";
  let overallStatus = "MANUAL_REVIEW_REQUIRED";
  if (explicitFailure) overallStatus = "FAILED";
  else if (documentOnly && profileDocumentPass) overallStatus = "VERIFIED";
  else if (fullPass) overallStatus = "VERIFIED";
  else if (partialPass) overallStatus = "PARTIALLY_VERIFIED";

  const failureReasons = [];
  if (!documentOnly && nidStatus === "FAIL") failureReasons.push("NID number on the front does not match the QR data.");
  if (!documentOnly && dobStatus === "FAIL") failureReasons.push("Date of birth on the front does not match the QR data.");
  if (!documentOnly && nameStatus === "FAIL") failureReasons.push("The names have a low similarity score.");
  if (profileNidStatus === "FAIL") failureReasons.push("The NID number in the buyer profile does not match the NID card.");
  if (profileDobStatus === "FAIL") failureReasons.push("The date of birth in the buyer profile does not match the NID card.");
  if (profileNameStatus === "FAIL") failureReasons.push("The account name does not match the name on the NID card.");
  if (!documentOnly && faceStatus === "FAIL") failureReasons.push("The live face does not match the NID portrait.");
  if (!documentOnly && livenessStatus === "FAIL") failureReasons.push("The active liveness challenge was not completed.");

  const warnings = [...(observation.ocr?.warnings || []), ...(observation.face?.warnings || []), ...(observation.liveness?.warnings || [])];
  if (!documentOnly && qrStatus === "QR_DATA_UNREADABLE") warnings.push("The QR code could not be detected or read from the NID back.");
  if (!documentOnly && qrStatus === "QR_DATA_NOT_PARSEABLE") warnings.push("The QR code was detected, but it did not contain identity fields in a supported readable format.");
  if (captureMode === "selfie") warnings.push("Video liveness was unavailable; a selfie fallback was used.");
  if (documentOnly && profileNidStatus === "INCONCLUSIVE") warnings.push("The NID number could not be compared between the buyer profile and NID front.");
  if (documentOnly && profileDobStatus === "INCONCLUSIVE") warnings.push("The date of birth could not be compared between the buyer profile and NID front.");
  if (documentOnly && profileNameStatus === "INCONCLUSIVE") warnings.push("The full name could not be compared between the buyer profile and NID front.");

  return {
    overallStatus,
    checks,
    fieldComparisons: {
      nidNumber: { front: maskNid(front.nidNumber), qr: maskNid(qr.nidNumber), match: nidStatus === "PASS" },
      name: { front: maskName(front.name), qr: maskName(qr.name), match: nameStatus === "PASS", similarity: nameSimilarity },
      dateOfBirth: { front: maskDate(frontDob), qr: maskDate(qrDob), match: dobStatus === "PASS" },
      profile: {
        name: maskName(profile.name),
        nidNumber: maskNid(profile.nidNumber),
        dateOfBirth: maskDate(profileDob)
      }
    },
    scores: {
      ocrConfidence: Number(observation.ocr?.confidence || 0),
      nameSimilarity,
      faceSimilarity
    },
    failureReasons,
    warnings: [...new Set(warnings)],
    maskedData: { nidNumber: maskNid(front.nidNumber || qr.nidNumber), name: maskName(front.name || qr.name), dateOfBirth: maskDate(frontDob || qrDob) },
    modelVersions: observation.modelVersions || {},
    thresholds: limits,
    automatedDecision: overallStatus === "VERIFIED" ? "approved" : documentOnly ? "rejected" : "pending",
    sensitive: {
      rawOcrText: observation.ocr?.rawText || "",
      rawQrData: observation.qr?.rawData || "",
      frontFields: front,
      qrFields: qr,
      profileFields: profile
    }
  };
}

async function userCanStartSession(user, buyerId) {
  const buyer = await User.findOne({ _id: buyerId, role: "buyer", status: "active", isVerified: true }).select("_id name email phone");
  if (!buyer) return { allowed: false, message: "An active, email-verified buyer is required" };
  if (user.role === "admin") return { allowed: true, buyer };
  const [loan, order] = await Promise.all([
    Loan.exists({ sellerId: user._id, buyerId, status: { $in: ["requested", "approved", "active", "closed", "defaulted"] } }),
    Order.exists({ sellerIds: user._id, buyerId })
  ]);
  return loan || order ? { allowed: true, buyer } : { allowed: false, message: "This buyer is not connected to your shop" };
}

async function listCandidateBuyers(user) {
  if (user.role === "admin") return User.find({ role: "buyer", status: "active", isVerified: true }).select("name email phone").sort({ name: 1 }).limit(500).lean();
  const [loanIds, orderIds] = await Promise.all([
    Loan.distinct("buyerId", { sellerId: user._id }),
    Order.distinct("buyerId", { sellerIds: user._id })
  ]);
  return User.find({ _id: { $in: [...loanIds, ...orderIds] }, role: "buyer", status: "active", isVerified: true })
    .select("name email phone").sort({ name: 1 }).lean();
}

function canViewSession(user, session) {
  const initiatorId = session.initiatedBy?._id?.toString?.() || session.initiatedBy?.toString?.();
  const buyerId = session.buyerId?._id?.toString?.() || session.buyerId?.toString?.();
  return user.role === "admin" || initiatorId === user._id.toString() || buyerId === user._id.toString();
}

function publicSession(session, result, sensitive) {
  const value = typeof session.toObject === "function" ? session.toObject() : session;
  const publicResult = result ? (typeof result.toObject === "function" ? result.toObject() : result) : null;
  if (publicResult && sensitive) {
    publicResult.fieldComparisons = {
      nidNumber: {
        ...(publicResult.fieldComparisons?.nidNumber || {}),
        front: sensitive.frontFields?.nidNumber || "",
        qr: sensitive.qrFields?.nidNumber || ""
      },
      name: {
        ...(publicResult.fieldComparisons?.name || {}),
        front: sensitive.frontFields?.name || "",
        qr: sensitive.qrFields?.name || ""
      },
      dateOfBirth: {
        ...(publicResult.fieldComparisons?.dateOfBirth || {}),
        front: sensitive.frontFields?.dateOfBirth || "",
        qr: sensitive.qrFields?.dateOfBirth || ""
      },
      profile: {
        ...(publicResult.fieldComparisons?.profile || {}),
        name: sensitive.profileFields?.name || "",
        nidNumber: sensitive.profileFields?.nidNumber || "",
        dateOfBirth: sensitive.profileFields?.dateOfBirth || ""
      }
    };
  }
  return {
    _id: value._id,
    buyer: value.buyerId,
    initiatedBy: value.initiatedBy,
    initiatorRole: value.initiatorRole,
    verificationType: value.verificationType,
    status: value.status,
    challenge: value.challenge,
    captureMode: value.captureMode,
    captures: {
      front: Boolean(value.artifacts?.front?.publicId),
      back: Boolean(value.artifacts?.back?.publicId),
      liveness: Boolean(value.artifacts?.liveness?.publicId)
    },
    expiresAt: value.expiresAt,
    completedAt: value.completedAt,
    purgeAt: value.purgeAt,
    purgedAt: value.purgedAt,
    lastError: value.status === "ERROR" ? value.lastError : undefined,
    result: publicResult,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt
  };
}

async function applyAutomatedDecision(session, result) {
  if (!session.kycDocumentId) return;
  const kyc = await KYCDocument.findById(session.kycDocumentId);
  if (!kyc) return;
  kyc.automatedVerification = {
    overallStatus: result.overallStatus,
    resultId: result._id,
    processedAt: result.processedAt
  };
  if (result.overallStatus === "VERIFIED") {
    kyc.status = "approved";
    kyc.reviewedAt = new Date();
    kyc.rejectionReason = undefined;
  } else if (session.verificationType === "nid_cross_check") {
    kyc.status = "rejected";
    kyc.reviewedAt = new Date();
    kyc.rejectionReason = result.failureReasons?.[0]
      || result.warnings?.[0]
      || "The NID front information could not be matched reliably with the back-side QR data.";
  }
  await kyc.save();
  await writeAudit(session.initiatedBy, `identity.${result.overallStatus.toLowerCase()}`, "IdentityVerificationSession", session._id, {
    buyerId: session.buyerId,
    kycDocumentId: kyc._id,
    automated: true
  });
  await Promise.all([
    createNotification({
      userId: session.buyerId,
      title: result.overallStatus === "VERIFIED" ? "Identity cross-check completed" : "Identity review needs attention",
      messageType: `identity_${result.overallStatus.toLowerCase()}`,
      message: result.overallStatus === "VERIFIED"
        ? session.verificationType === "nid_cross_check"
          ? "Your NID front information matches the QR data on the back. You may now request EMI."
          : "Your submitted NID information, QR data, and live face passed cross-validation."
        : `Your NID could not be approved: ${kyc.rejectionReason || result.overallStatus.replaceAll("_", " ").toLowerCase()}.`,
      category: "kyc",
      severity: result.overallStatus === "VERIFIED" ? "success" : result.overallStatus === "FAILED" ? "critical" : "warning",
      actionUrl: "/buyer?tab=kyc",
      metadata: { sessionId: session._id, result: result.overallStatus },
      dedupeKey: `identity:${session._id}:${result.overallStatus}:buyer`
    }),
    ...(session.initiatorRole === "buyer" ? [] : [createNotification({
      userId: session.initiatedBy,
      title: "Identity verification result ready",
      messageType: "identity_result_ready",
      message: `The customer identity cross-check finished as ${result.overallStatus.replaceAll("_", " ").toLowerCase()}.`,
      category: "kyc",
      severity: result.overallStatus === "VERIFIED" ? "success" : result.overallStatus === "FAILED" ? "critical" : "warning",
      actionUrl: `/${session.initiatorRole === "admin" ? "admin" : "seller"}?tab=identityVerification`,
      metadata: { sessionId: session._id, buyerId: session.buyerId, result: result.overallStatus },
      dedupeKey: `identity:${session._id}:${result.overallStatus}:initiator`
    })])
  ]).catch(() => {});
}

async function completeProcessing(session, observation) {
  let enrichedObservation = observation;
  if (session.verificationType === "nid_cross_check") {
    const [buyer, profile] = await Promise.all([
      User.findById(session.buyerId).select("name").lean(),
      BuyerProfile.findOne({ userId: session.buyerId }).select("nidNumber dateOfBirth").lean()
    ]);
    enrichedObservation = {
      ...observation,
      profileFields: { name: buyer?.name || "", nidNumber: profile?.nidNumber || "", dateOfBirth: profile?.dateOfBirth || "" }
    };
  }
  const decision = buildDecision(enrichedObservation, session.captureMode);
  const sensitive = decision.sensitive;
  delete decision.sensitive;
  const result = await IdentityVerificationResult.findOneAndUpdate(
    { sessionId: session._id },
    { ...decision, sessionId: session._id, buyerId: session.buyerId, processedAt: new Date() },
    { upsert: true, new: true, runValidators: true }
  );
  session.sensitivePayload = encryptJson(sensitive);
  session.status = "COMPLETED";
  session.completedAt = new Date();
  session.purgeAt = new Date(Date.now() + numberEnv("IDENTITY_ARTIFACT_RETENTION_HOURS", 24) * 60 * 60 * 1000);
  session.processingLeaseAt = undefined;
  session.lastError = undefined;
  await session.save();
  await applyAutomatedDecision(session, result);
  return result;
}

async function createLinkedKyc(session) {
  if (session.kycDocumentId) return KYCDocument.findById(session.kycDocumentId);
  const front = session.artifacts.front;
  const back = session.artifacts.back;
  const files = [front, back].filter((artifact) => artifact?.publicId).map((artifact, index) => ({
    originalName: index === 0 ? "nid-front" : "nid-back",
    filename: artifact.publicId.split("/").pop(),
    path: getSignedDeliveryUrl(artifact.publicId, artifact.resourceType),
    publicId: artifact.publicId,
    resourceType: artifact.resourceType,
    mimetype: `image/${artifact.format || "jpeg"}`,
    size: artifact.bytes
  }));
  const kyc = await KYCDocument.create({
    userId: session.buyerId,
    sellerId: session.sellerId,
    type: "nid",
    files,
    identityVerificationSessionId: session._id,
    verificationMethod: "identity_cross_validation"
  });
  session.kycDocumentId = kyc._id;
  await session.save();
  await notifyRole("admin", {
    title: "Automated identity review started",
    messageType: "identity_verification_queued",
    message: "A buyer identity cross-validation session is ready for automated processing.",
    category: "kyc",
    severity: "info",
    actionUrl: "/admin?tab=identityVerification",
    metadata: { sessionId: session._id, buyerId: session.buyerId },
    dedupeKey: `identity:${session._id}:queued:admin`
  }).catch(() => {});
  return kyc;
}

async function cleanupExpiredIdentityData() {
  const now = new Date();
  await IdentityVerificationSession.updateMany(
    { status: { $in: ["CREATED", "CAPTURING"] }, expiresAt: { $lte: now } },
    {
      $set: { status: "EXPIRED", purgeAt: new Date(Date.now() + numberEnv("IDENTITY_ARTIFACT_RETENTION_HOURS", 24) * 60 * 60 * 1000) },
      $unset: { linkTokenHash: 1, uploadTokenHash: 1 }
    }
  );
  const sessions = await IdentityVerificationSession.find({ purgeAt: { $lte: now }, purgedAt: null }).select("+sensitivePayload");
  for (const session of sessions) {
    await Promise.all(Object.values(session.artifacts?.toObject?.() || session.artifacts || {}).filter(Boolean).map(deleteUploadedFile));
    if (session.kycDocumentId) await KYCDocument.updateOne({ _id: session.kycDocumentId }, { $set: { files: [] }, $unset: { selfie: 1 } });
    session.artifacts = {};
    session.sensitivePayload = undefined;
    session.purgedAt = new Date();
    await session.save();
  }
  return { expired: true, purged: sessions.length };
}

function readSensitive(session) {
  try {
    return session.sensitivePayload ? decryptJson(session.sensitivePayload) : null;
  } catch {
    return null;
  }
}

module.exports = {
  FINAL_SESSION_STATUSES,
  applyAutomatedDecision,
  buildDecision,
  canViewSession,
  cleanupExpiredIdentityData,
  completeProcessing,
  createLinkedKyc,
  listCandidateBuyers,
  publicSession,
  readSensitive,
  thresholds,
  userCanStartSession
};
