const mongoose = require("mongoose");

const notificationLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    loanId: { type: mongoose.Schema.Types.ObjectId, ref: "Loan" },
    channel: { type: String, enum: ["sms", "email", "in_app"], required: true },
    title: { type: String, default: "Notification", trim: true },
    messageType: { type: String, required: true },
    message: { type: String, required: true },
    category: { type: String, default: "system", index: true },
    severity: { type: String, enum: ["info", "success", "warning", "critical"], default: "info" },
    actionUrl: { type: String, default: "" },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    dedupeKey: { type: String, sparse: true, unique: true },
    isRead: { type: Boolean, default: false, index: true },
    readAt: Date,
    status: { type: String, enum: ["queued", "sent", "failed"], default: "sent" },
    sentAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

notificationLogSchema.index({ userId: 1, channel: 1, sentAt: -1 });

module.exports = mongoose.model("NotificationLog", notificationLogSchema);
