const mongoose = require("mongoose");

const notificationLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    loanId: { type: mongoose.Schema.Types.ObjectId, ref: "Loan" },
    channel: { type: String, enum: ["sms", "email", "in_app"], required: true },
    messageType: { type: String, required: true },
    message: { type: String, required: true },
    status: { type: String, enum: ["queued", "sent", "failed"], default: "sent" },
    sentAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

module.exports = mongoose.model("NotificationLog", notificationLogSchema);
