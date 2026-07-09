const fs = require("fs");
const express = require("express");
const Product = require("../models/Product");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, authorize, requireActiveSeller } = require("../middleware/auth");
const { assertUploadedFilesSafe, createUploader } = require("../middleware/upload");
const { formBoolean, validateBody, z } = require("../middleware/validate");
const { deleteUploadedFile, uploadFile } = require("../utils/cloudinary");
const { writeAudit } = require("../services/auditService");

const router = express.Router();
const upload = createUploader("products");
const productCreateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  sku: z.string().trim().max(80).optional().default(""),
  brand: z.string().trim().max(120).optional().default(""),
  warranty: z.string().trim().max(160).optional().default(""),
  description: z.string().trim().max(2000).optional().default(""),
  category: z.string().trim().min(1).max(80).optional().default("General"),
  tags: z.preprocess((value) => (typeof value === "string" ? value.split(",").map((tag) => tag.trim()).filter(Boolean) : value), z.array(z.string()).optional().default([])),
  price: z.coerce.number().min(1),
  stock: z.coerce.number().int().min(0),
  lowStockThreshold: z.coerce.number().int().min(0).optional(),
  emiAvailable: formBoolean.optional().default(true),
  featured: formBoolean.optional().default(false)
});
const productUpdateSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  sku: z.string().trim().max(80).optional(),
  brand: z.string().trim().max(120).optional(),
  warranty: z.string().trim().max(160).optional(),
  description: z.string().trim().max(2000).optional(),
  category: z.string().trim().min(1).max(80).optional(),
  tags: z.preprocess((value) => (typeof value === "string" ? value.split(",").map((tag) => tag.trim()).filter(Boolean) : value), z.array(z.string()).optional()),
  status: z.enum(["active", "inactive"]).optional(),
  price: z.coerce.number().min(1).optional(),
  stock: z.coerce.number().int().min(0).optional(),
  lowStockThreshold: z.coerce.number().int().min(0).optional(),
  emiAvailable: formBoolean.optional(),
  featured: formBoolean.optional(),
  replaceImages: formBoolean.optional().default(false)
});

router.get(
  "/mine",
  authenticate,
  authorize("seller"),
  asyncHandler(async (req, res) => {
    const filter = { sellerId: req.user._id };
    if (["active", "inactive"].includes(req.query.status)) filter.status = req.query.status;
    const products = await Product.find(filter).sort({ createdAt: -1 });
    res.json(products);
  })
);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { q, category, sellerId, minPrice, maxPrice, sort } = req.query;
    const filter = { status: "active" };
    if (sellerId) filter.sellerId = sellerId;
    if (category) filter.category = category;
    if (minPrice || maxPrice) filter.price = { ...(minPrice && { $gte: Number(minPrice) }), ...(maxPrice && { $lte: Number(maxPrice) }) };
    if (q) filter.$text = { $search: q };
    const sortMap = {
      price_asc: { price: 1 },
      price_desc: { price: -1 },
      newest: { createdAt: -1 },
      popular: { featured: -1, createdAt: -1 }
    };
    const products = await Product.find(filter).populate("sellerId", "name phone").sort(sortMap[sort] || sortMap.newest);
    res.json(products);
  })
);

router.get(
  "/meta/filters",
  asyncHandler(async (_req, res) => {
    const [categories, sellers] = await Promise.all([
      Product.distinct("category", { status: "active" }),
      Product.find({ status: "active" }).populate("sellerId", "name").select("sellerId").lean()
    ]);
    const sellerMap = new Map();
    sellers.forEach((row) => {
      if (row.sellerId?._id) sellerMap.set(row.sellerId._id.toString(), row.sellerId);
    });
    res.json({ categories: categories.filter(Boolean).sort(), sellers: [...sellerMap.values()] });
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const product = await Product.findOne({ _id: req.params.id, status: "active" }).populate("sellerId", "name phone email");
    if (!product) return res.status(404).json({ message: "Product not found" });
    const related = await Product.find({ _id: { $ne: product._id }, category: product.category, status: "active" })
      .populate("sellerId", "name phone")
      .limit(4)
      .sort({ createdAt: -1 });
    res.json({ product, related });
  })
);

router.post(
  "/",
  authenticate,
  authorize("seller"),
  requireActiveSeller,
  upload.array("images", 5),
  validateBody(productCreateSchema),
  asyncHandler(async (req, res) => {
    await assertUploadedFilesSafe(req.files || []);
    const productImages = await Promise.all((req.files || []).map((file) => uploadAndBuild(file, `products/${req.user._id}`)));
    const product = await Product.create({
      sellerId: req.user._id,
      name: req.body.name,
      slug: buildSlug(req.body.name),
      sku: req.body.sku,
      brand: req.body.brand,
      warranty: req.body.warranty,
      description: req.body.description,
      category: req.body.category,
      tags: req.body.tags,
      price: req.body.price,
      stock: req.body.stock,
      lowStockThreshold: req.body.lowStockThreshold,
      emiAvailable: req.body.emiAvailable,
      featured: req.body.featured,
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
  validateBody(productUpdateSchema),
  asyncHandler(async (req, res) => {
    await assertUploadedFilesSafe(req.files || []);
    const product = await Product.findOne({ _id: req.params.id, sellerId: req.user._id });
    if (!product) return res.status(404).json({ message: "Product not found" });
    ["name", "sku", "brand", "warranty", "description", "category", "status"].forEach((key) => {
      if (req.body[key] !== undefined) product[key] = req.body[key];
    });
    if (req.body.name !== undefined) product.slug = buildSlug(req.body.name);
    if (req.body.tags !== undefined) product.tags = req.body.tags;
    if (req.body.price !== undefined) product.price = req.body.price;
    if (req.body.stock !== undefined) product.stock = req.body.stock;
    if (req.body.lowStockThreshold !== undefined) product.lowStockThreshold = req.body.lowStockThreshold;
    if (req.body.emiAvailable !== undefined) product.emiAvailable = req.body.emiAvailable;
    if (req.body.featured !== undefined) product.featured = req.body.featured;
    if (req.files?.length) {
      const nextImages = await Promise.all(req.files.map((file) => uploadAndBuild(file, `products/${req.user._id}`)));
      if (req.body.replaceImages) {
        await Promise.all((product.images || []).map(deleteUploadedFile));
        product.images = nextImages;
      } else {
        product.images.push(...nextImages);
      }
    }
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

function buildSlug(name) {
  return String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

module.exports = router;
