const express = require("express");
const EMIApplication = require("../models/EMIApplication");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

router.get(
  "/",
  authenticate,
  asyncHandler(async (req, res) => {
    const filter = {};
    if (req.user.role === "buyer") filter.buyerId = req.user._id;
    if (req.user.role === "seller") filter.sellerId = req.user._id;
    if (req.query.status) filter.status = req.query.status;
    const applications = await EMIApplication.find(filter)
      .populate("buyerId", "name email phone")
      .populate("sellerId", "name email phone")
      .populate("productId", "name price")
      .populate("loanId")
      .sort({ createdAt: -1 })
      .limit(300);
    res.json(applications);
  })
);

router.get(
  "/:id",
  authenticate,
  asyncHandler(async (req, res) => {
    const application = await EMIApplication.findById(req.params.id)
      .populate("buyerId", "name email phone")
      .populate("sellerId", "name email phone")
      .populate("productId", "name price")
      .populate("loanId");
    if (!application) return res.status(404).json({ message: "EMI application not found" });
    if (req.user.role === "buyer" && application.buyerId._id.toString() !== req.user._id.toString()) return res.status(403).json({ message: "Forbidden" });
    if (req.user.role === "seller" && application.sellerId._id.toString() !== req.user._id.toString()) return res.status(403).json({ message: "Forbidden" });
    res.json(application);
  })
);

module.exports = router;
