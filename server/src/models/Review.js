const mongoose = require("mongoose");

const reviewSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    buyerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, default: "" },
    status: { type: String, enum: ["published", "hidden"], default: "published", index: true }
  },
  { timestamps: true }
);

reviewSchema.index({ productId: 1, buyerId: 1 }, { unique: true });

module.exports = mongoose.model("Review", reviewSchema);
