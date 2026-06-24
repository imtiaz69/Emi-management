const mongoose = require("mongoose");

const buyerProfileSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    address: { type: String, default: "" },
    nidNumber: { type: String, default: "" },
    riskScore: { type: Number, default: 0 },
    riskCategory: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "low"
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("BuyerProfile", buyerProfileSchema);
