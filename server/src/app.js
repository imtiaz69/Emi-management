require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");
const multer = require("multer");

const authRoutes = require("./routes/authRoutes");
const adminRoutes = require("./routes/adminRoutes");
const addressRoutes = require("./routes/addressRoutes");
const cartRoutes = require("./routes/cartRoutes");
const categoryRoutes = require("./routes/categoryRoutes");
const couponRoutes = require("./routes/couponRoutes");
const disputeRoutes = require("./routes/disputeRoutes");
const emiApplicationRoutes = require("./routes/emiApplicationRoutes");
const inventoryRoutes = require("./routes/inventoryRoutes");
const orderRoutes = require("./routes/orderRoutes");
const productRoutes = require("./routes/productRoutes");
const profileRoutes = require("./routes/profileRoutes");
const kycRoutes = require("./routes/kycRoutes");
const loanRoutes = require("./routes/loanRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const returnRoutes = require("./routes/returnRoutes");
const reviewRoutes = require("./routes/reviewRoutes");
const buyerProfileRoutes = require("./routes/buyerProfileRoutes");
const sellerProfileRoutes = require("./routes/sellerProfileRoutes");
const systemConfigRoutes = require("./routes/systemConfigRoutes");
const { stripeRouter, stripeWebhookHandler } = require("./routes/stripeRoutes");
const reportRoutes = require("./routes/reportRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const userRoutes = require("./routes/userRoutes");
const wishlistRoutes = require("./routes/wishlistRoutes");
const { runOverdueCheck } = require("./jobs/overdueJob");
const { authenticate, authorize } = require("./middleware/auth");
const { createRateLimiter, mongoSanitize } = require("./middleware/security");

const app = express();
const authLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 30, message: "Too many auth attempts. Please try again later." });
const sensitiveLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 80, message: "Too many sensitive requests. Please slow down." });

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: process.env.CLIENT_URL || "http://localhost:5173", credentials: true }));
app.post("/api/payments/stripe/webhook", express.raw({ type: "application/json" }), stripeWebhookHandler);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(cookieParser());
app.use(morgan("dev"));
app.use(mongoSanitize);
app.use("/uploads/products", express.static(path.resolve(process.env.UPLOAD_DIR || "uploads", "products")));

app.get("/api/health", (_req, res) => res.json({ status: "ok", service: "emi-management-api" }));
app.post("/api/jobs/overdue-check", authenticate, authorize("seller", "admin"), async (_req, res, next) => {
  try {
    res.json(await runOverdueCheck());
  } catch (error) {
    next(error);
  }
});

app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/addresses", addressRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/buyer", buyerProfileRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/coupons", couponRoutes);
app.use("/api/disputes", disputeRoutes);
app.use("/api/emi-applications", emiApplicationRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/products", productRoutes);
app.use("/api/profiles", profileRoutes);
app.use("/api/kyc", sensitiveLimiter, kycRoutes);
app.use("/api/loans", loanRoutes);
app.use("/api/payments", sensitiveLimiter, paymentRoutes);
app.use("/api/payments/stripe", sensitiveLimiter, stripeRouter);
app.use("/api/returns", returnRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/seller-profile", sellerProfileRoutes);
app.use("/api/system-config", systemConfigRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/users", userRoutes);
app.use("/api/wishlist", wishlistRoutes);

app.use((req, res) => res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` }));
app.use((error, _req, res, _next) => {
  console.error(error);
  if (error instanceof multer.MulterError) return res.status(400).json({ message: error.message });
  if (error.name === "ZodError") return res.status(400).json({ message: "Validation failed", errors: error.issues });
  if (error.name === "CastError") return res.status(400).json({ message: "Invalid identifier" });
  if (error.code === 11000) return res.status(409).json({ message: "Duplicate record", fields: Object.keys(error.keyPattern || {}) });
  res.status(error.status || 500).json({ message: error.message || "Internal server error" });
});

module.exports = app;
