const express = require("express");
const InventoryLedger = require("../models/InventoryLedger");
const Product = require("../models/Product");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, authorize } = require("../middleware/auth");
const { objectId, validateBody, z } = require("../middleware/validate");
const { writeInventoryEntry } = require("../services/inventoryService");

const router = express.Router();
router.use(authenticate, authorize("seller", "admin"));
const stockAdjustmentSchema = z.object({
  productId: objectId,
  quantity: z.coerce.number().int(),
  note: z.string().trim().max(500).optional().default("Manual stock adjustment")
});

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

router.post(
  "/adjust",
  validateBody(stockAdjustmentSchema),
  asyncHandler(async (req, res) => {
    if (req.body.quantity === 0) return res.status(400).json({ message: "Adjustment quantity cannot be zero" });
    const filter = { _id: req.body.productId };
    if (req.user.role === "seller") filter.sellerId = req.user._id;
    const product = await Product.findOne(filter);
    if (!product) return res.status(404).json({ message: "Product not found" });
    if (product.stock + req.body.quantity < 0) return res.status(400).json({ message: "Stock cannot become negative" });
    product.stock += req.body.quantity;
    await product.save();
    await writeInventoryEntry({
      product,
      type: req.body.quantity > 0 ? "stock_in" : "stock_adjustment",
      quantity: req.body.quantity,
      referenceType: "ManualAdjustment",
      referenceId: product._id,
      note: req.body.note
    });
    res.json(product);
  })
);

module.exports = router;
