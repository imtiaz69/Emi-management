const express = require("express");
const Wishlist = require("../models/Wishlist");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, authorize } = require("../middleware/auth");
const { objectId, validateBody, z } = require("../middleware/validate");

const router = express.Router();
router.use(authenticate, authorize("buyer"));

const wishlistSchema = z.object({ productId: objectId });

router.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(await getWishlist(req.user._id));
  })
);

router.post(
  "/",
  validateBody(wishlistSchema),
  asyncHandler(async (req, res) => {
    await Wishlist.findOneAndUpdate({ buyerId: req.user._id }, { $addToSet: { products: req.body.productId } }, { upsert: true });
    res.status(201).json(await getWishlist(req.user._id));
  })
);

router.delete(
  "/:productId",
  asyncHandler(async (req, res) => {
    await Wishlist.findOneAndUpdate({ buyerId: req.user._id }, { $pull: { products: req.params.productId } });
    res.json(await getWishlist(req.user._id));
  })
);

function getWishlist(buyerId) {
  return Wishlist.findOneAndUpdate({ buyerId }, { $setOnInsert: { buyerId, products: [] } }, { upsert: true, new: true }).populate("products");
}

module.exports = router;
