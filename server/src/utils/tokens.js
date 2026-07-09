const jwt = require("jsonwebtoken");
const crypto = require("crypto");

function signToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), role: user.role, status: user.status },
    process.env.JWT_SECRET || "dev-secret",
    { expiresIn: process.env.JWT_EXPIRES_IN || "15m" }
  );
}

function createRefreshTokenValue() {
  return crypto.randomBytes(48).toString("hex");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function getRefreshExpiry() {
  const days = Number(process.env.REFRESH_TOKEN_EXPIRES_IN_DAYS || 30);
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

module.exports = { createRefreshTokenValue, getRefreshExpiry, hashToken, signToken };
