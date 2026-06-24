const fs = require("fs");
const express = require("express");
const Product = require("../models/Product");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, authorize, requireActiveSeller } = require("../middleware/auth");
const { createUploader } = require("../middleware/upload");
const { uploadFile } = require("../utils/cloudinary");
const { writeAudit } = require("../services/auditService");

const router = express.Router();
const upload = createUploader("products");

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { q, category, sellerId, minPrice, maxPrice } = req.query;
    const filter = { status: "active" };
    if (sellerId) filter.sellerId = sellerId;
    if (category) filter.category = category;
    if (minPrice || maxPrice) filter.price = { ...(minPrice && { $gte: Number(minPrice) }), ...(maxPrice && { $lte: Number(maxPrice) }) };
    if (q) filter.$text = { $search: q };
    const products = await Product.find(filter).populate("sellerId", "name phone").sort({ createdAt: -1 });
    res.json(products);
  })
);

router.post(
  "/",
  authenticate,
  authorize("seller"),
  requireActiveSeller,
  upload.array("images", 5),
  asyncHandler(async (req, res) => {
    const productImages = await Promise.all((req.files || []).map((file) => uploadAndBuild(file, `products/${req.user._id}`)));
    const product = await Product.create({
      sellerId: req.user._id,
      name: req.body.name,
      description: req.body.description,
      category: req.body.category,
      price: Number(req.body.price),
      stock: Number(req.body.stock),
      emiAvailable: req.body.emiAvailable !== "false",
      images: productImages
    });
    await writeAudit(req.user._id, "product.created", "Product", product._id);
    res.status(201).json(product);
  })
);

router.patch(
  "/:id",
  authenticate,
  authorize("seller"),
  requireActiveSeller,
  upload.array("images", 5),
  asyncHandler(async (req, res) => {
    const product = await Product.findOne({ _id: req.params.id, sellerId: req.user._id });
    if (!product) return res.status(404).json({ message: "Product not found" });
    ["name", "description", "category", "status"].forEach((key) => {
      if (req.body[key] !== undefined) product[key] = req.body[key];
    });
    if (req.body.price !== undefined) product.price = Number(req.body.price);
    if (req.body.stock !== undefined) product.stock = Number(req.body.stock);
    if (req.body.emiAvailable !== undefined) product.emiAvailable = req.body.emiAvailable !== "false";
    if (req.files?.length) product.images.push(...await Promise.all(req.files.map((file) => uploadAndBuild(file, `products/${req.user._id}`))));
    await product.save();
    await writeAudit(req.user._id, "product.updated", "Product", product._id);
    res.json(product);
  })
);

router.delete(
  "/:id",
  authenticate,
  authorize("seller"),
  requireActiveSeller,
  asyncHandler(async (req, res) => {
    const product = await Product.findOneAndUpdate({ _id: req.params.id, sellerId: req.user._id }, { status: "inactive" }, { new: true });
    if (!product) return res.status(404).json({ message: "Product not found" });
    await writeAudit(req.user._id, "product.deleted", "Product", product._id);
    res.json({ message: "Product archived" });
  })
);

async function uploadAndBuild(file, folder) {
  const result = await uploadFile(file.path, folder);
  if (!result.local) {
    await fs.promises.unlink(file.path).catch(() => {});
  }
  return {
    originalName: file.originalname,
    filename: file.filename,
    path: result.secure_url,
    publicId: result.public_id,
    mimetype: file.mimetype,
    size: file.size
  };
}

module.exports = router;
