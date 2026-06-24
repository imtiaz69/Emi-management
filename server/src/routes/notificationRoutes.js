const express = require("express");
const NotificationLog = require("../models/NotificationLog");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

router.get(
  "/",
  authenticate,
  asyncHandler(async (req, res) => {
    const filter = req.user.role === "admin" ? {} : { userId: req.user._id };
    const logs = await NotificationLog.find(filter).populate("loanId").sort({ sentAt: -1 }).limit(100);
    res.json(logs);
  })
);

module.exports = router;
