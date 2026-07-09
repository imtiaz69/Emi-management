const express = require("express");
const Category = require("../models/Category");
const Product = require("../models/Product");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, authorize } = require("../middleware/auth");
const { validateBody, z } = require("../middleware/validate");

const router = express.Router();
const categorySchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).optional().default(""),
  status: z.enum(["active", "inactive"]).optional().default("active")
});

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const categories = await Category.find({ status: "active" }).sort({ name: 1 });
    const productCategories = await Product.distinct("category", { status: "active" });
    const existing = new Set(categories.map((category) => category.name));
    res.json([
      ...categories,
      ...productCategories.filter((name) => name && !existing.has(name)).map((name) => ({ _id: name, name, slug: buildSlug(name), status: "active" }))
    ]);
  })
);

router.post(
  "/",
  authenticate,
  authorize("admin"),
  validateBody(categorySchema),
  asyncHandler(async (req, res) => {
    const category = await Category.create({ ...req.body, slug: buildSlug(req.body.name) });
    res.status(201).json(category);
  })
);

function buildSlug(name) {
  return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

module.exports = router;
