const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    loanId: { type: mongoose.Schema.Types.ObjectId, ref: "Loan", index: true },
    scheduleId: { type: mongoose.Schema.Types.ObjectId, ref: "EMISchedule" },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", index: true },
    transactionType: { type: String, enum: ["installment", "down_payment", "order_payment", "refund", "fee"], default: "installment", index: true },
    buyerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    amount: { type: Number, required: true, min: 1 },
    method: { type: String, enum: ["cash", "bank", "cheque", "bkash", "nagad", "sslcommerz", "mock_gateway", "stripe"], required: true },
    status: { type: String, enum: ["pending", "confirmed", "failed", "refunded"], default: "confirmed", index: true },
    paymentDate: { type: Date, default: Date.now },
    gatewayRef: String,
    receiptNo: { type: String, unique: true },
    allocations: [
      {
        scheduleId: { type: mongoose.Schema.Types.ObjectId, ref: "EMISchedule" },
        installmentNo: Number,
        amount: Number
      }
    ],
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    notes: String
  },
  { timestamps: true }
);

transactionSchema.index({ gatewayRef: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("Transaction", transactionSchema);
