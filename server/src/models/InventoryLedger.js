const mongoose = require("mongoose");

const inventoryLedgerSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: {
      type: String,
      enum: ["stock_in", "stock_adjustment", "reservation", "sale", "cancel_release", "return"],
      required: true,
      index: true
    },
    quantity: { type: Number, required: true },
    referenceType: String,
    referenceId: { type: mongoose.Schema.Types.ObjectId },
    note: String
  },
  { timestamps: true }
);

module.exports = mongoose.model("InventoryLedger", inventoryLedgerSchema);
