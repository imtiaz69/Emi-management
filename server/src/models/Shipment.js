const mongoose = require("mongoose");

const shipmentSchema = new mongoose.Schema(
  {
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    courierName: { type: String, default: "" },
    trackingNo: { type: String, default: "" },
    status: { type: String, enum: ["pending", "packed", "shipped", "delivered", "failed"], default: "pending", index: true },
    shippedAt: Date,
    deliveredAt: Date
  },
  { timestamps: true }
);

module.exports = mongoose.model("Shipment", shipmentSchema);
