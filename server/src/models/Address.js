const mongoose = require("mongoose");

const addressSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    label: { type: String, default: "Home", trim: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    line1: { type: String, required: true, trim: true },
    line2: { type: String, default: "", trim: true },
    city: { type: String, required: true, trim: true },
    area: { type: String, default: "", trim: true },
    postalCode: { type: String, default: "", trim: true },
    isDefault: { type: Boolean, default: false }
  },
  { timestamps: true }
);

addressSchema.index({ userId: 1, isDefault: 1 });

module.exports = mongoose.model("Address", addressSchema);
