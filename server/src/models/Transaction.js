const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    loanId: { type: mongoose.Schema.Types.ObjectId, ref: "Loan", required: true, index: true },
    scheduleId: { type: mongoose.Schema.Types.ObjectId, ref: "EMISchedule" },
    buyerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    amount: { type: Number, required: true, min: 1 },
    method: { type: String, enum: ["cash", "bank", "cheque", "bkash", "nagad", "sslcommerz", "mock_gateway"], required: true },
    paymentDate: { type: Date, default: Date.now },
    gatewayRef: String,
    receiptNo: { type: String, unique: true },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    notes: String
  },
  { timestamps: true }
);

module.exports = mongoose.model("Transaction", transactionSchema);
