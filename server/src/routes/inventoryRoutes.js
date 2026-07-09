const express = require("express");
const InventoryLedger = require("../models/InventoryLedger");
const Product = require("../models/Product");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, authorize } = require("../middleware/auth");

const router = express.Router();
router.use(authenticate, authorize("seller", "admin"));

router.get(
  "/ledger",
  asyncHandler(async (req, res) => {
    const filter = {};
    if (req.user.role === "seller") filter.sellerId = req.user._id;
    if (req.query.productId) filter.productId = req.query.productId;
    res.json(await InventoryLedger.find(filter).populate("productId", "name stock stockReserved").sort({ createdAt: -1 }).limit(200));
  })
);

router.get(
  "/stock",
  asyncHandler(async (req, res) => {
    const filter = {};
    if (req.user.role === "seller") filter.sellerId = req.user._id;
    const products = await Product.find(filter).select("name stock stockReserved lowStockThreshold status").sort({ name: 1 });
    res.json(products);
  })
);

module.exports = router;
