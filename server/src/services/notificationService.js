const NotificationLog = require("../models/NotificationLog");
const User = require("../models/User");
const { emitToUser } = require("./socketService");

function publicNotification(notification) {
  return typeof notification.toJSON === "function" ? notification.toJSON() : notification;
}

async function createNotification({
  userId,
  loanId,
  channel = "in_app",
  title = "Notification",
  messageType,
  message,
  category = "system",
  severity = "info",
  actionUrl = "",
  metadata = {},
  dedupeKey
}) {
  const normalizedUserId = userId?.toString();
  if (!normalizedUserId) throw new Error("Notification userId is required");

  const uniqueKey = dedupeKey ? `${normalizedUserId}:${channel}:${dedupeKey}` : undefined;
  let notification;
  try {
    notification = await NotificationLog.create({
      userId,
      loanId,
      channel,
      title,
      messageType,
      message,
      category,
      severity,
      actionUrl,
      metadata,
      dedupeKey: uniqueKey,
      status: "sent",
      sentAt: new Date()
    });
  } catch (error) {
    if (error.code !== 11000 || !uniqueKey) throw error;
    return NotificationLog.findOne({ dedupeKey: uniqueKey });
  }

  if (channel === "in_app") {
    emitToUser(normalizedUserId, "notification:new", publicNotification(notification));
  }
  return notification;
}

async function notifyRole(role, payload) {
  const users = await User.find({ role, status: { $ne: "suspended" }, isVerified: true }).select("_id");
  return Promise.all(
    users.map((user) =>
      createNotification({
        ...payload,
        userId: user._id,
        dedupeKey: payload.dedupeKey ? `${payload.dedupeKey}:${user._id}` : undefined
      })
    )
  );
}

async function notifyLowStockProduct(product, asOf = new Date()) {
  if (!product || product.status !== "active" || Number(product.stock) > Number(product.lowStockThreshold)) return null;
  const dateKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.APP_TIMEZONE || "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(asOf));
  const stockState = Number(product.stock) === 0 ? "out" : "low";
  return createNotification({
    userId: product.sellerId,
    title: Number(product.stock) === 0 ? "Product out of stock" : "Low stock alert",
    messageType: Number(product.stock) === 0 ? "product_out_of_stock" : "product_low_stock",
    message: `${product.name}${product.sku ? ` (${product.sku})` : ""} has ${product.stock} unit${Number(product.stock) === 1 ? "" : "s"} remaining.`,
    category: "inventory",
    severity: Number(product.stock) === 0 ? "critical" : "warning",
    actionUrl: "/seller?tab=myProducts",
    metadata: {
      productId: product._id,
      stock: product.stock,
      lowStockThreshold: product.lowStockThreshold
    },
    dedupeKey: `low-stock:${product._id}:${stockState}:${dateKey}`
  });
}

async function sendMockNotification(payload) {
  return createNotification(payload);
}

async function sendReminderSet(payload) {
  return [await createNotification({ ...payload, channel: "in_app" })];
}

module.exports = {
  createNotification,
  notifyLowStockProduct,
  notifyRole,
  publicNotification,
  sendMockNotification,
  sendReminderSet
};
