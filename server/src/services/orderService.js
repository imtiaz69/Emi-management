const mongoose = require("mongoose");
const Cart = require("../models/Cart");
const Coupon = require("../models/Coupon");
const Loan = require("../models/Loan");
const Order = require("../models/Order");
const Product = require("../models/Product");
const Shipment = require("../models/Shipment");
const { calculateSchedule } = require("./emiService");
const { convertReservationToSale, releaseReservation, reserveStock } = require("./inventoryService");
const { writeAudit } = require("./auditService");
const { assertBuyerReadyForEmi } = require("./buyerReadinessService");
const { createApplicationForLoan, recordDownPayment } = require("./loanService");

function buildOrderNo() {
  return `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function inferPaymentMode(items) {
  const modes = [...new Set(items.map((item) => item.financeMode))];
  return modes.length === 1 ? modes[0] : "mixed";
}

async function calculateDiscount(code, subtotal, session) {
  if (!code) return { discount: 0, coupon: null };
  const coupon = await Coupon.findOne({ code: code.toUpperCase(), active: true }).session(session);
  if (!coupon) throw new Error("Coupon is invalid");
  const now = new Date();
  if (coupon.startsAt && coupon.startsAt > now) throw new Error("Coupon is not active yet");
  if (coupon.expiresAt && coupon.expiresAt < now) throw new Error("Coupon has expired");
  if (subtotal < coupon.minOrderAmount) throw new Error(`Coupon requires minimum order BDT ${coupon.minOrderAmount}`);
  if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) throw new Error("Coupon usage limit reached");

  const rawDiscount = coupon.type === "percentage" ? (subtotal * coupon.value) / 100 : coupon.value;
  const discount = coupon.maxDiscount ? Math.min(rawDiscount, coupon.maxDiscount) : rawDiscount;
  return { discount: Math.min(discount, subtotal), coupon };
}

async function createOrderFromCart({ buyerId, shippingAddress, billingAddress, couponCode, deliveryCharge = 0, emi = {} }) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const cart = await Cart.findOne({ buyerId }).session(session);
    if (!cart || cart.items.length === 0) throw new Error("Cart is empty");

    const orderItems = [];
    for (const cartItem of cart.items) {
      const product = await Product.findOne({ _id: cartItem.productId, status: "active" }).session(session);
      if (!product) throw new Error("A product in your cart is no longer available");
      if (product.stock < cartItem.quantity) throw new Error(`${product.name} has only ${product.stock} item(s) available`);
      orderItems.push({
        product,
        productId: product._id,
        sellerId: product.sellerId,
        name: product.name,
        quantity: cartItem.quantity,
        unitPrice: product.price,
        totalPrice: product.price * cartItem.quantity,
        financeMode: cartItem.selectedFinanceMode
      });
    }
    if (orderItems.some((item) => item.financeMode === "emi")) {
      await assertBuyerReadyForEmi(buyerId, { session });
    }

    const subtotal = orderItems.reduce((sum, item) => sum + item.totalPrice, 0);
    const { discount, coupon } = await calculateDiscount(couponCode, subtotal, session);
    const total = Math.max(0, subtotal + Number(deliveryCharge || 0) - discount);
    const order = await Order.create(
      [
        {
          orderNo: buildOrderNo(),
          buyerId,
          sellerIds: [...new Set(orderItems.map((item) => item.sellerId.toString()))],
          items: orderItems.map(({ product, ...item }) => item),
          subtotal,
          discount,
          deliveryCharge: Number(deliveryCharge || 0),
          total,
          paymentMode: inferPaymentMode(orderItems),
          paymentStatus: orderItems.some((item) => item.financeMode === "emi") ? "partial" : "unpaid",
          shippingAddress,
          billingAddress: billingAddress || shippingAddress,
          couponCode: couponCode ? couponCode.toUpperCase() : undefined
        }
      ],
      { session }
    ).then((docs) => docs[0]);

    for (const item of orderItems) {
      await reserveStock(item.product, item.quantity, "Order", order._id, { session, note: `Reserved for ${order.orderNo}` });
    }

    await Shipment.insertMany(
      order.sellerIds.map((sellerId) => ({
        orderId: order._id,
        sellerId
      })),
      { session }
    );

    if (coupon) {
      coupon.usedCount += 1;
      await coupon.save({ session });
    }

    await createRequestedLoansForEmiItems(order, emi, session);
    await Cart.findOneAndUpdate({ buyerId }, { $set: { items: [] } }, { session });
    await writeAudit(buyerId, "order.created", "Order", order._id, { orderNo: order.orderNo }, { session });

    await session.commitTransaction();
    return getOrderForUser(order._id, { role: "buyer", _id: buyerId });
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}

async function createRequestedLoansForEmiItems(order, emi, session) {
  const emiItems = order.items.filter((item) => item.financeMode === "emi");
  if (!emiItems.length) return;

  const totalEmiPrincipal = emiItems.reduce((sum, item) => sum + item.totalPrice, 0);
    const requestedDownPayment = Math.min(Number(emi.downPayment || 0), totalEmiPrincipal - 1);
  const downPaymentRatio = totalEmiPrincipal > 0 ? requestedDownPayment / totalEmiPrincipal : 0;

  for (const item of emiItems) {
    const downPayment = Math.round(item.totalPrice * downPaymentRatio);
    const result = calculateSchedule({
      principal: item.totalPrice,
      downPayment,
      interestRate: Number(emi.interestRate ?? 12),
      interestType: emi.interestType || "flat",
      tenureMonths: Number(emi.tenureMonths ?? 6)
    });

    const loan = await Loan.create(
      [
        {
          sellerId: item.sellerId,
          buyerId: order.buyerId,
          productId: item.productId,
          orderId: order._id,
          orderItemId: item._id,
          source: "marketplace",
          principal: item.totalPrice,
          downPayment,
          interestRate: Number(emi.interestRate ?? 12),
          interestType: emi.interestType || "flat",
          tenureMonths: Number(emi.tenureMonths ?? 6),
          lateFeePolicy: emi.lateFeePolicy || { type: "daily", value: 20 },
          totalPayable: result.totalPayable,
          status: "requested"
        }
      ],
      { session }
    ).then((docs) => docs[0]);

    await createApplicationForLoan(loan, session);
    await recordDownPayment({
      loan,
      orderId: order._id,
      amount: downPayment,
      method: emi.downPaymentMethod || "mock_gateway",
      actorId: order.buyerId,
      session,
      notes: `Online EMI down payment for order ${order.orderNo}`
    });

    item.loanId = loan._id;
  }
  await order.save({ session });
}

async function getOrderForUser(orderId, user) {
  const filter = { _id: orderId };
  if (user.role === "buyer") filter.buyerId = user._id;
  if (user.role === "seller") filter.sellerIds = user._id;

  return Order.findOne(filter)
    .populate("buyerId", "name email phone")
    .populate("sellerIds", "name phone")
    .populate("items.productId", "name images")
    .populate("items.loanId")
    .lean();
}

async function listOrdersForUser(user, query = {}) {
  const filter = {};
  if (user.role === "buyer") filter.buyerId = user._id;
  if (user.role === "seller") filter.sellerIds = user._id;
  if (query.fulfillmentStatus) filter.fulfillmentStatus = query.fulfillmentStatus;
  if (query.paymentStatus) filter.paymentStatus = query.paymentStatus;
  return Order.find(filter)
    .populate("buyerId", "name email phone")
    .populate("items.productId", "name images")
    .populate("items.loanId")
    .sort({ createdAt: -1 })
    .limit(200);
}

async function cancelOrder(orderId, user) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const filter = { _id: orderId, fulfillmentStatus: { $nin: ["cancelled", "delivered", "returned"] } };
    if (user.role === "buyer") filter.buyerId = user._id;
    if (user.role === "seller") filter.sellerIds = user._id;
    const order = await Order.findOne(filter).session(session);
    if (!order) throw new Error("Order not found or cannot be cancelled");

    for (const item of order.items) {
      if (user.role === "seller" && item.sellerId.toString() !== user._id.toString()) continue;
      const product = await Product.findById(item.productId).session(session);
      if (product && item.fulfillmentStatus !== "cancelled") {
        await releaseReservation(product, item.quantity, "Order", order._id, { session, note: `Released ${order.orderNo}` });
      }
      item.fulfillmentStatus = "cancelled";
      if (item.loanId) {
        await Loan.findByIdAndUpdate(item.loanId, { status: "rejected", rejectionReason: "Order cancelled" }, { session });
      }
    }

    if (order.items.every((item) => item.fulfillmentStatus === "cancelled")) {
      order.fulfillmentStatus = "cancelled";
    }
    await order.save({ session });
    await writeAudit(user._id, "order.cancelled", "Order", order._id, {}, { session });
    await session.commitTransaction();
    return getOrderForUser(order._id, user);
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}

async function markOrderPaid(orderId, user, method = "mock_gateway") {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const order = await Order.findOne({ _id: orderId, buyerId: user._id, paymentStatus: { $ne: "paid" } }).session(session);
    if (!order) throw new Error("Payable order not found");
    for (const item of order.items.filter((row) => row.financeMode === "cash")) {
      const product = await Product.findById(item.productId).session(session);
      if (product) {
        await convertReservationToSale(product, item.quantity, "Order", order._id, { session, note: `Paid by ${method}` });
      }
    }
    order.paymentStatus = order.items.some((item) => item.financeMode === "emi") ? "partial" : "paid";
    order.fulfillmentStatus = "confirmed";
    order.items.forEach((item) => {
      if (item.financeMode === "cash") item.fulfillmentStatus = "confirmed";
    });
    await order.save({ session });
    await writeAudit(user._id, "order.paid", "Order", order._id, { method }, { session });
    await session.commitTransaction();
    return getOrderForUser(order._id, user);
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}

async function updateOrderFulfillment(orderId, sellerId, payload) {
  const order = await Order.findOne({ _id: orderId, sellerIds: sellerId });
  if (!order) throw new Error("Order not found for this seller");
  const sellerItems = order.items.filter((item) => item.sellerId.toString() === sellerId.toString());
  sellerItems.forEach((item) => {
    item.fulfillmentStatus = payload.fulfillmentStatus || item.fulfillmentStatus;
  });
  if (order.items.every((item) => item.fulfillmentStatus === sellerItems[0].fulfillmentStatus)) {
    order.fulfillmentStatus = sellerItems[0].fulfillmentStatus;
  }
  await order.save();

  const shipment = await Shipment.findOneAndUpdate(
    { orderId: order._id, sellerId },
    {
      courierName: payload.courierName,
      trackingNo: payload.trackingNo,
      status: payload.shipmentStatus || mapFulfillmentToShipment(payload.fulfillmentStatus),
      ...(payload.fulfillmentStatus === "shipped" ? { shippedAt: new Date() } : {}),
      ...(payload.fulfillmentStatus === "delivered" ? { deliveredAt: new Date() } : {})
    },
    { new: true, upsert: true }
  );

  return { order, shipment };
}

function mapFulfillmentToShipment(status) {
  if (status === "processing") return "packed";
  if (status === "shipped") return "shipped";
  if (status === "delivered") return "delivered";
  return "pending";
}

module.exports = {
  cancelOrder,
  createOrderFromCart,
  getOrderForUser,
  listOrdersForUser,
  markOrderPaid,
  updateOrderFulfillment
};
