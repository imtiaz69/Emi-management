const mongoose = require("mongoose");

const imageSchema = new mongoose.Schema(
  {
    originalName: String,
    filename: String,
    path: String,
    publicId: String,
    mimetype: String,
    size: Number
  },
  { _id: false }
);

const productSchema = new mongoose.Schema(
  {
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, trim: true, index: true },
    sku: { type: String, trim: true },
    brand: { type: String, trim: true },
    warranty: { type: String, trim: true },
    description: { type: String, default: "" },
    category: { type: String, default: "General", index: true },
    specifications: { type: mongoose.Schema.Types.Mixed, default: {} },
    variants: [
      {
        name: String,
        value: String,
        sku: String,
        priceAdjustment: { type: Number, default: 0 },
        stock: { type: Number, default: 0 }
      }
    ],
    tags: [String],
    price: { type: Number, required: true, min: 0 },
    stock: { type: Number, required: true, min: 0 },
    stockReserved: { type: Number, default: 0, min: 0 },
    lowStockThreshold: { type: Number, default: 3 },
    images: [imageSchema],
    emiAvailable: { type: Boolean, default: true },
    featured: { type: Boolean, default: false },
    approvalStatus: { type: String, enum: ["pending", "approved", "rejected"], default: "approved", index: true },
    status: { type: String, enum: ["active", "inactive"], default: "active" }
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

productSchema.virtual("stockAvailable").get(function stockAvailable() {
  return Math.max(0, Number(this.stock || 0));
});

productSchema.index({ sellerId: 1, status: 1 });
productSchema.index({ name: "text", description: "text", category: "text" });

module.exports = mongoose.model("Product", productSchema);
