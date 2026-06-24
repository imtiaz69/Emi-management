const jwt = require("jsonwebtoken");

function signToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), role: user.role, status: user.status },
    process.env.JWT_SECRET || "dev-secret",
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );
}

module.exports = { signToken };
