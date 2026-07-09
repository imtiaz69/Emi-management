const rateLimit = require("express-rate-limit");

function createRateLimiter({ windowMs = 15 * 60 * 1000, max = 100, message = "Too many requests. Please try again later." } = {}) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message }
  });
}

function mongoSanitize(req, _res, next) {
  sanitizeObject(req.body);
  sanitizeObject(req.query);
  sanitizeObject(req.params);
  next();
}

function sanitizeObject(value) {
  if (!value || typeof value !== "object") return value;
  Object.keys(value).forEach((key) => {
    const sanitizedKey = key.replace(/^\$+/g, "").replace(/\./g, "");
    if (sanitizedKey !== key) {
      value[sanitizedKey] = value[key];
      delete value[key];
    }
    sanitizeObject(value[sanitizedKey]);
  });
  return value;
}

function requireVerified(req, res, next) {
  if (!req.user?.isVerified) return res.status(403).json({ message: "Account verification is required for this action" });
  next();
}

module.exports = { createRateLimiter, mongoSanitize, requireVerified };
