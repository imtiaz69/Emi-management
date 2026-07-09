const express = require("express");
const SystemConfig = require("../models/SystemConfig");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, authorize } = require("../middleware/auth");

const router = express.Router();

router.get(
  "/platform",
  authenticate,
  authorize("admin", "seller"),
  asyncHandler(async (_req, res) => {
    const config = await SystemConfig.findOne({ key: "platform" });
    res.json(config?.value || {});
  })
);

module.exports = router;
