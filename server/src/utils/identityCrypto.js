const crypto = require("crypto");

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function tokenMatches(token, expectedHash) {
  if (!token || !expectedHash) return false;
  const actual = Buffer.from(hashToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function encryptionKey() {
  const configured = process.env.IDENTITY_DATA_ENCRYPTION_KEY;
  if (configured) {
    const decoded = Buffer.from(configured, "base64");
    if (decoded.length === 32) return decoded;
    const error = new Error("IDENTITY_DATA_ENCRYPTION_KEY must be a base64-encoded 32-byte value");
    error.status = 500;
    throw error;
  }
  if (process.env.NODE_ENV === "production") {
    const error = new Error("IDENTITY_DATA_ENCRYPTION_KEY is required");
    error.status = 503;
    throw error;
  }
  return crypto.createHash("sha256").update(process.env.JWT_SECRET || "identity-development-key").digest();
}

function encryptJson(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64")
  };
}

function decryptJson(payload) {
  if (!payload?.iv || !payload?.tag || !payload?.ciphertext) return null;
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, "base64")), decipher.final()]).toString("utf8"));
}

module.exports = { decryptJson, encryptJson, hashToken, randomToken, tokenMatches };
