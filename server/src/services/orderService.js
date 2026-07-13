const mongoose = require("mongoose");
const Cart = require("../models/Cart");
const Coupon = require("../models/Coupon");
const Loan = require("../models/Loan");
const Order = require("../models/Order");
const Product = require("../models/Product");
const Shipment = require("../models/Shipment");
const Transaction = require("../models/Transaction");
const { calculateSchedule } = require("./emiService");
const { convertReservationToSale, releaseReservation, reserveStock } = require("./inventoryService");
const { writeAudit } = require("./auditService");
const { assertBuyerReadyForEmi } = require("./buyerReadinessService");
const { buildReceiptNo, createApplicationForLoan, recordDownPayment } = require("./loanService");
const { createMockGatewayReference } = require("./paymentService");

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

async function createOrderFromCart({ buyerId, shippingAddress, billingAddress, couponCode, deliveryCharge = 0, itemIds = [], emi = {} }) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const cart = await Cart.findOne({ buyerId }).session(session);
    if (!cart || cart.items.length === 0) throw new Error("Cart is empty");
    const selectedItemIds = new Set((itemIds || []).map(String));
    const selectedCartItems = selectedItemIds.size
      ? cart.items.filter((item) => selectedItemIds.has(item._id.toString()))
      : cart.items;
    if (selectedCartItems.length === 0) throw new Error("Select at least one cart item before checkout");

    const orderItems = [];
    for (const cartItem of selectedCartItems) {
      const product = await Product.findOne({ _id: cartItem.productId, status: "active" }).session(session);
      if (!product) throw new Error("A product in your cart is no longer available");
      if (product.stock < cartItem.quantity) throw new Error(`${product.name} has only ${product.stock} item(s) available`);
      orderItems.push({
        product,
        cartItemId: cartItem._id,
        productId: product._id,
        sellerId: product.sellerId,
        name: product.name,
        quantity: cartItem.quantity,
        unitPrice: product.price,
        totalPrice: product.price * cartItem.quantity,
        financeMode: cartItem.selectedFinanceMode,
        selectedColorName: cartItem.selectedColorName,
        selectedColorHex: cartItem.selectedColorHex
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
    if (selectedItemIds.size) {
      const selectedObjectIds = [...selectedItemIds].map((id) => new mongoose.Types.ObjectId(id));
      await Cart.findOneAndUpdate(
        { buyerId },
        { $pull: { items: { _id: { $in: selectedObjectIds } } } },
        { session }
      );
    } else {
      await Cart.findOneAndUpdate({ buyerId }, { $set: { items: [] } }, { session });
    }
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

  const emiByCartItemId = new Map((emi.items || []).map((item) => [item.cartItemId, item]));

  for (const item of emiItems) {
    const product = await Product.findById(item.productId).session(session);
    if (!product) throw new Error("EMI product not found");
    const itemConfig = emiByCartItemId.get(item.cartItemId?.toString());
    const minDownPayment = Number(product.emiMinDownPayment || 0) * Number(item.quantity || 1);
    const downPayment = Number(itemConfig?.downPayment ?? Math.max(minDownPayment, Number(emi.downPayment || 0)));
    const tenureMonths = Number(itemConfig?.tenureMonths ?? Math.min(Number(emi.tenureMonths || product.emiMaxTenureMonths || 12), Number(product.emiMaxTenureMonths || 12)));
    if (downPayment < minDownPayment) throw new Error(`${product.name} requires minimum down payment BDT ${minDownPayment}`);
    if (downPayment >= item.totalPrice) throw new Error(`${product.name} down payment must be lower than product total`);
    if (tenureMonths > Number(product.emiMaxTenureMonths || 12)) throw new Error(`${product.name} maximum EMI tenure is ${product.emiMaxTenureMonths} months`);

    const result = calculateSchedule({
      principal: item.totalPrice,
      downPayment,
      interestRate: Number(product.emiInterestRate || 0),
      interestType: product.emiInterestType || "flat",
      tenureMonths
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
          interestRate: Number(product.emiInterestRate || 0),
          interestType: product.emiInterestType || "flat",
          tenureMonths,
          selectedColorName: item.selectedColorName,
          selectedColorHex: item.selectedColorHex,
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
  return markOrderPaidWithOptions(orderId, user, method);
}

function allocateCashOrderPayments(order) {
  const sellerTotals = new Map();
  for (const item of order.items.filter((row) => row.financeMode === "cash")) {
    const sellerId = item.sellerId.toString();
    sellerTotals.set(sellerId, Number(sellerTotals.get(sellerId) || 0) + Number(item.totalPrice || 0));
  }

  const entries = [...sellerTotals.entries()];
  const subtotal = entries.reduce((sum, [, amount]) => sum + amount, 0);
  if (!subtotal) return [];
  const payableTotal = Math.round(Number(order.total || subtotal || 0));
  let allocated = 0;

  return entries.map(([sellerId, sellerSubtotal], index) => {
    const amount = index === entries.length - 1 ? payableTotal - allocated : Math.round((payableTotal * sellerSubtotal) / subtotal);
    allocated += amount;
    return { sellerId, amount: Math.max(amount, 0) };
  }).filter((entry) => entry.amount > 0);
}

async function markOrderPaidWithOptions(orderId, user, method = "mock_gateway", options = {}) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const order = await Order.findOne({ _id: orderId, buyerId: user._id }).session(session);
    if (!order) throw new Error("Payable order not found");
    if (order.paymentStatus === "paid") {
      await session.commitTransaction();
      return getOrderForUser(order._id, user);
    }
    if (order.paymentMode !== "cash" || order.paymentStatus !== "unpaid") {
      const error = new Error("Only unpaid cash orders can be paid through this checkout");
      error.status = 400;
      throw error;
    }

    const actorId = options.recordedBy || user._id;
    const paymentDate = options.paymentDate || new Date();
    const gatewayRef = options.gatewayRef || (method === "mock_gateway" ? createMockGatewayReference("ORDER") : undefined);
    const notes = options.notes || (method === "stripe" ? "Stripe Checkout cash order payment" : "Cash order payment");
    const paymentAllocations = allocateCashOrderPayments(order);
    if (!paymentAllocations.length) {
      const error = new Error("This order has no payable cash items");
      error.status = 400;
      throw error;
    }

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

    const transactions = await Transaction.insertMany(
      paymentAllocations.map((entry) => ({
        orderId: order._id,
        transactionType: "order_payment",
        buyerId: order.buyerId,
        sellerId: entry.sellerId,
        amount: entry.amount,
        method,
        paymentDate,
        gatewayRef: gatewayRef ? `${gatewayRef}:${entry.sellerId}` : undefined,
        receiptNo: buildReceiptNo("ORD"),
        recordedBy: actorId,
        notes,
        status: "confirmed"
      })),
      { session }
    );

    await writeAudit(
      actorId,
      "order.paid",
      "Order",
      order._id,
      { method, transactionIds: transactions.map((transaction) => transaction._id) },
      { session }
    );
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
  markOrderPaidWithOptions,
  updateOrderFulfillment
};
