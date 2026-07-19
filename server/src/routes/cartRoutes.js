const express = require("express");
const Cart = require("../models/Cart");
const Product = require("../models/Product");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, authorize } = require("../middleware/auth");
const { objectId, validateBody, z } = require("../middleware/validate");
const { requireVerified } = require("../middleware/security");
const { assertBuyerReadyForEmi } = require("../services/buyerReadinessService");

const router = express.Router();
router.use(authenticate, authorize("buyer"), requireVerified);

const cartItemSchema = z.object({
  productId: objectId,
  quantity: z.coerce.number().int().min(1).max(50).optional().default(1),
  selectedFinanceMode: z.enum(["cash", "emi"]).optional().default("cash"),
  selectedColorName: z.string().trim().min(1).max(40).optional(),
  replaceExisting: z.boolean().optional().default(false)
});
const updateItemSchema = z.object({
  quantity: z.coerce.number().int().min(1).max(50).optional(),
  selectedFinanceMode: z.enum(["cash", "emi"]).optional(),
  selectedColorName: z.string().trim().min(1).max(40).optional()
});

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const cart = await getOrCreateCart(req.user._id);
    res.json(await populateCart(cart._id));
  })
);

router.post(
  "/items",
  validateBody(cartItemSchema),
  asyncHandler(async (req, res) => {
    const product = await Product.findOne({ _id: req.body.productId, status: "active" });
    if (!product) return res.status(404).json({ message: "Product not found" });
    if (product.stock < req.body.quantity) return res.status(400).json({ message: "Not enough stock available" });
    if (req.body.selectedFinanceMode === "emi" && !product.emiAvailable) return res.status(400).json({ message: "This product is not EMI available" });
    if (req.body.selectedFinanceMode === "emi") {
      await assertBuyerReadyForEmi(req.user._id);
    }
    const selectedColor = resolveSelectedColor(product, req.body.selectedColorName);

    const cart = await getOrCreateCart(req.user._id);
    const existing = cart.items.find((item) => item.productId.toString() === product._id.toString() && item.selectedColorName === selectedColor.name);
    if (existing) {
      existing.quantity = req.body.replaceExisting ? req.body.quantity : Math.min(existing.quantity + req.body.quantity, product.stock);
      existing.selectedFinanceMode = req.body.selectedFinanceMode;
      existing.selectedColorName = selectedColor.name;
      existing.selectedColorHex = selectedColor.hex;
      existing.unitPrice = product.price;
    } else {
      cart.items.push({
        productId: product._id,
        sellerId: product.sellerId,
        quantity: req.body.quantity,
        unitPrice: product.price,
        selectedFinanceMode: req.body.selectedFinanceMode,
        selectedColorName: selectedColor.name,
        selectedColorHex: selectedColor.hex
      });
    }
    await cart.save();
    res.status(201).json(await populateCart(cart._id));
  })
);

router.patch(
  "/items/:itemId",
  validateBody(updateItemSchema),
  asyncHandler(async (req, res) => {
    const cart = await getOrCreateCart(req.user._id);
    const item = cart.items.id(req.params.itemId);
    if (!item) return res.status(404).json({ message: "Cart item not found" });
    const product = await Product.findById(item.productId);
    if (!product) return res.status(404).json({ message: "Product not found" });
    if (req.body.quantity !== undefined) {
      if (product.stock < req.body.quantity) return res.status(400).json({ message: "Not enough stock available" });
      item.quantity = req.body.quantity;
    }
    if (req.body.selectedFinanceMode) {
      if (req.body.selectedFinanceMode === "emi" && !product.emiAvailable) return res.status(400).json({ message: "This product is not EMI available" });
      if (req.body.selectedFinanceMode === "emi") {
        await assertBuyerReadyForEmi(req.user._id);
      }
      item.selectedFinanceMode = req.body.selectedFinanceMode;
    }
    if (req.body.selectedColorName) {
      const selectedColor = resolveSelectedColor(product, req.body.selectedColorName);
      item.selectedColorName = selectedColor.name;
      item.selectedColorHex = selectedColor.hex;
    }
    item.unitPrice = product.price;
    await cart.save();
    res.json(await populateCart(cart._id));
  })
);

router.delete(
  "/items/:itemId",
  asyncHandler(async (req, res) => {
    const cart = await getOrCreateCart(req.user._id);
    cart.items.pull(req.params.itemId);
    await cart.save();
    res.json(await populateCart(cart._id));
  })
);

router.delete(
  "/",
  asyncHandler(async (req, res) => {
    const cart = await getOrCreateCart(req.user._id);
    cart.items = [];
    await cart.save();
    res.json(cart);
  })
);

async function getOrCreateCart(buyerId) {
  return Cart.findOneAndUpdate({ buyerId }, { $setOnInsert: { buyerId, items: [] } }, { upsert: true, new: true });
}

async function populateCart(id) {
  return Cart.findById(id).populate("items.productId").populate("items.sellerId", "name phone");
}

function resolveSelectedColor(product, requestedColorName) {
  const colors = normalizeProductColors(product);
  const selected = requestedColorName
    ? colors.find((color) => color.name.toLowerCase() === requestedColorName.toLowerCase())
    : colors[0];
  if (!selected) {
    const error = new Error("Please select a valid product color");
    error.status = 400;
    throw error;
  }
  return selected;
}

function normalizeProductColors(product) {
  const colors = (product.colors || []).filter((color) => color?.name);
  return colors.length ? colors : [{ name: "Default", hex: "#64748b" }];
}

module.exports = router;
