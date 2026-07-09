const express = require("express");
const Cart = require("../models/Cart");
const Product = require("../models/Product");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, authorize } = require("../middleware/auth");
const { objectId, validateBody, z } = require("../middleware/validate");

const router = express.Router();
router.use(authenticate, authorize("buyer"));

const cartItemSchema = z.object({
  productId: objectId,
  quantity: z.coerce.number().int().min(1).max(50).optional().default(1),
  selectedFinanceMode: z.enum(["cash", "emi"]).optional().default("cash")
});
const updateItemSchema = z.object({
  quantity: z.coerce.number().int().min(1).max(50).optional(),
  selectedFinanceMode: z.enum(["cash", "emi"]).optional()
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

    const cart = await getOrCreateCart(req.user._id);
    const existing = cart.items.find((item) => item.productId.toString() === product._id.toString());
    if (existing) {
      existing.quantity = Math.min(existing.quantity + req.body.quantity, product.stock);
      existing.selectedFinanceMode = req.body.selectedFinanceMode;
      existing.unitPrice = product.price;
    } else {
      cart.items.push({
        productId: product._id,
        sellerId: product.sellerId,
        quantity: req.body.quantity,
        unitPrice: product.price,
        selectedFinanceMode: req.body.selectedFinanceMode
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
      item.selectedFinanceMode = req.body.selectedFinanceMode;
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

module.exports = router;
