const express = require("express");
const Review = require("../models/Review");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, authorize } = require("../middleware/auth");
const { objectId, validateBody, z } = require("../middleware/validate");

const router = express.Router();
const reviewSchema = z.object({
  productId: objectId,
  orderId: objectId.optional(),
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional().default("")
});

router.get(
  "/product/:productId",
  asyncHandler(async (req, res) => {
    const reviews = await Review.find({ productId: req.params.productId, status: "published" }).populate("buyerId", "name").sort({ createdAt: -1 });
    res.json(reviews);
  })
);

router.post(
  "/",
  authenticate,
  authorize("buyer"),
  validateBody(reviewSchema),
  asyncHandler(async (req, res) => {
    const review = await Review.findOneAndUpdate(
      { productId: req.body.productId, buyerId: req.user._id },
      { ...req.body, buyerId: req.user._id },
      { upsert: true, new: true, runValidators: true }
    );
    res.status(201).json(review);
  })
);

module.exports = router;
