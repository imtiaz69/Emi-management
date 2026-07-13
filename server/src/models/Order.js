const mongoose = require("mongoose");

const addressSchema = new mongoose.Schema(
  {
    name: String,
    phone: String,
    line1: String,
    line2: String,
    city: String,
    area: String,
    postalCode: String
  },
  { _id: false }
);

const orderItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    cartItemId: { type: mongoose.Schema.Types.ObjectId },
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    totalPrice: { type: Number, required: true, min: 0 },
    financeMode: { type: String, enum: ["cash", "emi"], default: "cash" },
    selectedColorName: { type: String, trim: true },
    selectedColorHex: { type: String, trim: true },
    fulfillmentStatus: {
      type: String,
      enum: ["pending", "confirmed", "processing", "shipped", "delivered", "cancelled", "returned"],
      default: "pending"
    },
    loanId: { type: mongoose.Schema.Types.ObjectId, ref: "Loan" }
  },
  { timestamps: true }
);

const orderSchema = new mongoose.Schema(
  {
    orderNo: { type: String, required: true, unique: true, index: true },
    buyerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    sellerIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", index: true }],
    items: [orderItemSchema],
    subtotal: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    deliveryCharge: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },
    paymentMode: { type: String, enum: ["cash", "emi", "mixed"], required: true },
    paymentStatus: { type: String, enum: ["unpaid", "partial", "paid", "refunded"], default: "unpaid", index: true },
    fulfillmentStatus: {
      type: String,
      enum: ["pending", "confirmed", "processing", "shipped", "delivered", "cancelled", "returned"],
      default: "pending",
      index: true
    },
    shippingAddress: addressSchema,
    billingAddress: addressSchema,
    couponCode: String,
    placedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Order", orderSchema);
