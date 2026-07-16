const mongoose = require("mongoose");

const fileSchema = new mongoose.Schema(
  {
    originalName: String,
    filename: String,
    path: String,
    publicId: String,
    resourceType: String,
    mimetype: String,
    size: Number
  },
  { _id: false }
);

const buyerProfileSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    profilePhoto: fileSchema,
    address: { type: String, default: "" },
    nidNumber: { type: String, default: "" },
    emergencyContactName: { type: String, default: "" },
    emergencyContactPhone: { type: String, default: "" },
    monthlyIncome: { type: Number, default: 0, min: 0 },
    occupation: { type: String, default: "" },
    employmentType: {
      type: String,
      enum: ["", "salaried", "self_employed", "business_owner", "student", "unemployed", "other"],
      default: ""
    },
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
