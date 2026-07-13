const express = require("express");
const Loan = require("../models/Loan");
const Order = require("../models/Order");
const PaymentLog = require("../models/PaymentLog");
const Transaction = require("../models/Transaction");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, authorize } = require("../middleware/auth");
const { requireVerified } = require("../middleware/security");
const { objectId, validateBody, z } = require("../middleware/validate");
const { getPaymentAllocationPreview, recordPayment } = require("../services/loanService");
const { markOrderPaidWithOptions } = require("../services/orderService");
const { getStripeClient, getStripeCurrency, toStripeAmount } = require("../services/stripeService");

const router = express.Router();
const createCheckoutSessionSchema = z.object({
  loanId: objectId,
  amount: z.coerce.number().min(1),
  allocationMode: z.enum(["next_due", "next_n", "overdue", "advance", "custom"]).optional().default("advance"),
  installmentCount: z.coerce.number().int().min(1).max(60).optional()
});
const createOrderCheckoutSessionSchema = z.object({
  orderId: objectId
});
const confirmCheckoutSessionSchema = z.object({
  sessionId: z.string().trim().min(5).max(300)
});

async function recordStripeLoanPayment(session) {
  const gatewayRef = session.payment_intent || session.id;
  const existingTransaction = await Transaction.findOne({ gatewayRef });

  if (existingTransaction) {
    await updatePaymentLog(session, "confirmed", "checkout.session.completed", existingTransaction);
    return existingTransaction;
  }

  const transaction = await recordPayment(
    {
      loanId: session.metadata.loanId,
      amount: Number(session.metadata.amountBdt),
      method: "stripe",
      allocationMode: session.metadata.allocationMode || "advance",
      installmentCount: session.metadata.installmentCount ? Number(session.metadata.installmentCount) : undefined,
      gatewayRef,
      notes: "Stripe Checkout payment"
    },
    session.metadata.buyerId,
    { requireBuyerOwnership: true }
  );
  await updatePaymentLog(session, "confirmed", "checkout.session.completed", transaction);
  return transaction;
}

async function recordStripeOrderPayment(session) {
  const gatewayRef = session.payment_intent || session.id;
  const orderId = session.metadata?.orderId;
  const buyerId = session.metadata?.buyerId;
  if (!orderId || !buyerId) {
    const error = new Error("Stripe order payment metadata is incomplete");
    error.status = 400;
    throw error;
  }

  const existingTransaction = await Transaction.findOne({ orderId, transactionType: "order_payment", method: "stripe" });
  if (existingTransaction) {
    await updatePaymentLog(session, "confirmed", "checkout.session.completed", existingTransaction);
    return existingTransaction;
  }

  const order = await markOrderPaidWithOptions(
    orderId,
    { _id: buyerId, role: "buyer" },
    "stripe",
    {
      gatewayRef,
      recordedBy: buyerId,
      notes: "Stripe Checkout cash order payment"
    }
  );
  await updatePaymentLog(session, "confirmed", "checkout.session.completed", order);
  return order;
}

async function recordStripeCheckoutPayment(session) {
  if (session.metadata?.paymentFor === "order") {
    return recordStripeOrderPayment(session);
  }
  return recordStripeLoanPayment(session);
}

async function updatePaymentLog(session, status, eventType, result) {
  const metadata = { ...(session.metadata || {}) };
  if (result?._id) {
    metadata.resultId = result._id.toString();
  }

  return PaymentLog.findOneAndUpdate(
    { provider: "stripe", sessionId: session.id },
    {
      provider: "stripe",
      sessionId: session.id,
      paymentIntentId: session.payment_intent,
      loanId: session.metadata?.loanId,
      orderId: session.metadata?.orderId,
      buyerId: session.metadata?.buyerId,
      amount: Number(session.metadata?.amountBdt || 0),
      currency: session.currency,
      status,
      eventType,
      metadata
    },
    { upsert: true, new: true }
  );
}

router.post(
  "/create-checkout-session",
  authenticate,
  authorize("buyer"),
  requireVerified,
  validateBody(createCheckoutSessionSchema),
  asyncHandler(async (req, res) => {
    const { loanId, allocationMode, installmentCount } = req.body;
    const amount = Number(req.body.amount);
    if (!loanId || !Number.isFinite(amount) || amount < 1) {
      const error = new Error("Loan ID and a valid payment amount are required");
      error.status = 400;
      throw error;
    }

    const loan = await Loan.findOne({ _id: loanId, buyerId: req.user._id, status: "active" }).populate("productId", "name");
    if (!loan) {
      const error = new Error("Active loan not found for this buyer");
      error.status = 404;
      throw error;
    }

    const allocationPreview = await getPaymentAllocationPreview({ loanId: loan._id, allocationMode, installmentCount });
    if (allocationPreview.outstanding < 1) {
      const error = new Error("This loan has no payable installments");
      error.status = 400;
      throw error;
    }
    if (amount > allocationPreview.outstanding) {
      const error = new Error(`Payment cannot exceed selected EMI amount BDT ${Math.round(allocationPreview.outstanding)}`);
      error.status = 400;
      throw error;
    }

    const stripe = getStripeClient();
    const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";
    const currency = getStripeCurrency();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      adaptive_pricing: { enabled: false },
      automatic_tax: { enabled: false },
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency,
            product_data: {
              name: loan.productId?.name ? `EMI payment - ${loan.productId.name}` : "EMI installment payment"
            },
            unit_amount: toStripeAmount(amount)
          },
          quantity: 1
        }
      ],
      success_url: `${clientUrl}/buyer?stripe=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${clientUrl}/buyer?stripe=cancel&session_id={CHECKOUT_SESSION_ID}`,
      metadata: {
        paymentFor: "loan",
        loanId: loan._id.toString(),
        buyerId: req.user._id.toString(),
        amountBdt: String(Math.round(amount)),
        allocationMode,
        ...(allocationMode === "next_n" && installmentCount ? { installmentCount: String(installmentCount) } : {})
      }
    });
    await updatePaymentLog(session, "pending", "checkout.session.created");

    res.status(201).json({ sessionId: session.id, url: session.url });
  })
);

router.post(
  "/create-order-checkout-session",
  authenticate,
  authorize("buyer"),
  requireVerified,
  validateBody(createOrderCheckoutSessionSchema),
  asyncHandler(async (req, res) => {
    const order = await Order.findOne({ _id: req.body.orderId, buyerId: req.user._id });
    if (!order) {
      const error = new Error("Order not found for this buyer");
      error.status = 404;
      throw error;
    }
    if (order.paymentMode !== "cash" || order.paymentStatus !== "unpaid") {
      const error = new Error("Stripe checkout is available only for unpaid cash orders");
      error.status = 400;
      throw error;
    }
    if (Number(order.total || 0) < 1) {
      const error = new Error("Order total must be greater than zero");
      error.status = 400;
      throw error;
    }

    const stripe = getStripeClient();
    const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";
    const currency = getStripeCurrency();
    const itemNames = order.items.slice(0, 2).map((item) => item.name).join(", ");
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      adaptive_pricing: { enabled: false },
      automatic_tax: { enabled: false },
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency,
            product_data: {
              name: `Cash order payment - ${order.orderNo}`,
              description: itemNames || "EMI Management ecommerce order"
            },
            unit_amount: toStripeAmount(order.total)
          },
          quantity: 1
        }
      ],
      success_url: `${clientUrl}/orders/${order._id}?stripe=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${clientUrl}/orders/${order._id}?stripe=cancel&session_id={CHECKOUT_SESSION_ID}`,
      metadata: {
        paymentFor: "order",
        orderId: order._id.toString(),
        orderNo: order.orderNo,
        buyerId: req.user._id.toString(),
        amountBdt: String(Math.round(order.total))
      }
    });
    await updatePaymentLog(session, "pending", "checkout.session.created");

    res.status(201).json({ sessionId: session.id, url: session.url });
  })
);

router.post(
  "/confirm-checkout-session",
  authenticate,
  authorize("buyer"),
  requireVerified,
  validateBody(confirmCheckoutSessionSchema),
  asyncHandler(async (req, res) => {
    if (!req.body.sessionId) {
      const error = new Error("Stripe session ID is required");
      error.status = 400;
      throw error;
    }

    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.retrieve(req.body.sessionId);

    if (session.metadata?.buyerId !== req.user._id.toString()) {
      const error = new Error("Stripe session does not belong to this buyer");
      error.status = 403;
      throw error;
    }
    if (session.payment_status !== "paid") {
      await updatePaymentLog(session, session.status === "expired" ? "cancelled" : "failed", "checkout.session.return_not_paid");
      const error = new Error("Stripe payment is not completed yet");
      error.status = 400;
      throw error;
    }

    const transaction = await recordStripeCheckoutPayment(session);
    res.json(transaction);
  })
);

async function stripeWebhookHandler(req, res, next) {
  try {
    const stripe = getStripeClient();
    const signature = req.headers["stripe-signature"];
    let event;

    if (process.env.STRIPE_WEBHOOK_SECRET) {
      event = stripe.webhooks.constructEvent(req.body, signature, process.env.STRIPE_WEBHOOK_SECRET);
    } else if (process.env.NODE_ENV === "production") {
      const error = new Error("Stripe webhook secret is required in production");
      error.status = 500;
      throw error;
    } else {
      event = JSON.parse(req.body.toString());
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      await recordStripeCheckoutPayment(session);
    }
    if (event.type === "checkout.session.expired") {
      await updatePaymentLog(event.data.object, "cancelled", event.type);
    }
    if (event.type === "payment_intent.payment_failed") {
      const intent = event.data.object;
      await PaymentLog.findOneAndUpdate({ provider: "stripe", paymentIntentId: intent.id }, { status: "failed", eventType: event.type, metadata: intent.metadata || {} }, { upsert: true });
    }

    res.json({ received: true });
  } catch (error) {
    next(error);
  }
}

module.exports = { stripeRouter: router, stripeWebhookHandler };
