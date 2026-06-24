const NotificationLog = require("../models/NotificationLog");

async function sendMockNotification({ userId, loanId, channel = "in_app", messageType, message }) {
  return NotificationLog.create({
    userId,
    loanId,
    channel,
    messageType,
    message,
    status: "sent",
    sentAt: new Date()
  });
}

async function sendReminderSet({ userId, loanId, messageType, message }) {
  return Promise.all(["sms", "email", "in_app"].map((channel) => sendMockNotification({ userId, loanId, channel, messageType, message })));
}

module.exports = { sendMockNotification, sendReminderSet };
