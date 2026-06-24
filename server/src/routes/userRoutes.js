const express = require("express");
const User = require("../models/User");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, authorize } = require("../middleware/auth");

const router = express.Router();
router.use(authenticate);

router.get(
  "/",
  authorize("seller", "admin"),
  asyncHandler(async (req, res) => {
    const filter = {};
    if (req.query.role) filter.role = req.query.role;
    if (req.query.status) filter.status = req.query.status;
    const users = await User.find(filter).select("-passwordHash").sort({ createdAt: -1 }).limit(200);
    res.json(users);
  })
);

module.exports = router;
