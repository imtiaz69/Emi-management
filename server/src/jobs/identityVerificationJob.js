const IdentityVerificationSession = require("../models/IdentityVerificationSession");
const { completeProcessing, cleanupExpiredIdentityData } = require("../services/identityVerificationService");
const { emitToUser } = require("../services/socketService");

let processing = false;
let timer;
let cleanupTimer;

const transientStatusPattern = /\b(?:429|500|502|503|504)\b/;
const transientNetworkPattern = /fetch failed|failed to fetch|aborted|econn|enotfound|socket|timeout|temporarily unavailable/i;

function isTransientAiError(error) {
  const message = String(error?.message || error || "");
  return transientNetworkPattern.test(message)
    || (/Identity AI returned/i.test(message) && transientStatusPattern.test(message));
}

function retryDelayMs(attempts) {
  const base = Number(process.env.IDENTITY_AI_RETRY_BASE_MS || 15_000);
  return Math.min(base * 2 ** Math.max(0, attempts - 1), 120_000);
}

function safeAiErrorMessage(error) {
  if (isTransientAiError(error)) {
    return "The verification service is waking up or temporarily unavailable. Your verification will retry automatically.";
  }
  const message = String(error?.message || "Identity processing failed");
  return message.replace(/<!doctype[\s\S]*$/i, "").trim().slice(0, 300) || "Identity processing failed";
}

function notifySession(session) {
  const payload = { sessionId: session._id.toString(), status: session.status, updatedAt: session.updatedAt || new Date() };
  emitToUser(session.initiatedBy, "identity:session.updated", payload);
  emitToUser(session.buyerId, "identity:session.updated", payload);
}

async function callAiService(session) {
  const baseUrl = (process.env.IDENTITY_AI_URL || "").replace(/\/$/, "");
  const publicApiUrl = (process.env.IDENTITY_PUBLIC_API_URL || "").replace(/\/$/, "");
  const serviceKey = process.env.IDENTITY_AI_SERVICE_KEY;
  if (!baseUrl || !publicApiUrl || !serviceKey) throw new Error("Identity AI service or public API URL is not configured");

  session.status = "WAKING_AI";
  await session.save();
  notifySession(session);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.IDENTITY_AI_TIMEOUT_MS || 180000));
  try {
    const healthResponse = await fetch(`${baseUrl}/health`, { signal: controller.signal });
    if (!healthResponse.ok) throw new Error(`Identity AI returned ${healthResponse.status} while waking`);

    const response = await fetch(`${baseUrl}/v1/identity/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Identity-Service-Key": serviceKey },
      body: JSON.stringify({
        sessionId: session._id.toString(),
        frontUrl: `${publicApiUrl}/api/identity-verifications/ai-assets/${session._id}/front`,
        backUrl: session.artifacts?.back?.publicId
          ? `${publicApiUrl}/api/identity-verifications/ai-assets/${session._id}/back`
          : null,
        livenessUrl: session.artifacts?.liveness?.publicId
          ? `${publicApiUrl}/api/identity-verifications/ai-assets/${session._id}/liveness`
          : null,
        captureMode: session.captureMode || "document_only",
        challenge: session.challenge || []
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      const contentType = response.headers.get("content-type") || "";
      const message = contentType.includes("application/json")
        ? await response.text().catch(() => "")
        : "";
      throw new Error(`Identity AI returned ${response.status}${message ? `: ${message.slice(0, 160)}` : ""}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function leaseNextJob() {
  const staleBefore = new Date(Date.now() - 5 * 60 * 1000);
  return IdentityVerificationSession.findOneAndUpdate(
    {
      $or: [
        { status: "QUEUED", $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: new Date() } }] },
        { status: { $in: ["WAKING_AI", "PROCESSING"] }, processingLeaseAt: { $lte: staleBefore } }
      ]
    },
    { $set: { status: "PROCESSING", processingLeaseAt: new Date() }, $inc: { processingAttempts: 1 } },
    { new: true, sort: { createdAt: 1 } }
  );
}

async function runIdentityVerificationJobs() {
  if (processing) return { busy: true };
  processing = true;
  let handled = 0;
  try {
    let session;
    while ((session = await leaseNextJob())) {
      handled += 1;
      notifySession(session);
      try {
        const observation = await callAiService(session);
        const result = await completeProcessing(session, observation);
        notifySession(session);
        emitToUser(session.initiatedBy, "identity:session.completed", {
          sessionId: session._id.toString(),
          status: result.overallStatus
        });
      } catch (error) {
        const attempts = Number(session.processingAttempts || 0);
        const transient = isTransientAiError(error);
        const maxAttempts = Number(process.env.IDENTITY_AI_MAX_ATTEMPTS || 6);
        session.lastError = safeAiErrorMessage(error);
        session.processingLeaseAt = undefined;
        if (transient && attempts < maxAttempts) {
          session.status = "QUEUED";
          session.nextAttemptAt = new Date(Date.now() + retryDelayMs(attempts));
        } else {
          session.status = "ERROR";
        }
        await session.save();
        notifySession(session);
      }
    }
    return { handled };
  } finally {
    processing = false;
  }
}

function startIdentityVerificationJobs() {
  clearInterval(timer);
  clearInterval(cleanupTimer);
  timer = setInterval(() => runIdentityVerificationJobs().catch((error) => console.error("Identity job failed", error.message)), 5000);
  cleanupTimer = setInterval(() => cleanupExpiredIdentityData().catch((error) => console.error("Identity cleanup failed", error.message)), 15 * 60 * 1000);
  timer.unref?.();
  cleanupTimer.unref?.();
  cleanupExpiredIdentityData().catch((error) => console.error("Initial identity cleanup failed", error.message));
  runIdentityVerificationJobs().catch((error) => console.error("Initial identity job failed", error.message));
}

module.exports = {
  isTransientAiError,
  retryDelayMs,
  runIdentityVerificationJobs,
  safeAiErrorMessage,
  startIdentityVerificationJobs
};
