const express = require("express");
const Loan = require("../models/Loan");
const EMISchedule = require("../models/EMISchedule");
const PaymentLog = require("../models/PaymentLog");
const Transaction = require("../models/Transaction");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, authorize } = require("../middleware/auth");
const { requireVerified } = require("../middleware/security");
const { objectId, validateBody, z } = require("../middleware/validate");
const { recordPayment } = require("../services/loanService");
const { getStripeClient, toStripeAmount } = require("../services/stripeService");

const router = express.Router();
const createCheckoutSessionSchema = z.object({
  loanId: objectId,
  amount: z.coerce.number().min(1),
  allocationMode: z.enum(["next_due", "overdue", "advance", "custom"]).optional().default("advance")
});
const confirmCheckoutSessionSchema = z.object({
  sessionId: z.string().trim().min(5).max(300)
});

async function getOutstandingAmount(loanId) {
  const schedules = await EMISchedule.find({ loanId, status: { $in: ["pending", "partial", "overdue"] } });
  return schedules.reduce((sum, schedule) => {
    const due = Number(schedule.amountDue || 0) + Number(schedule.lateFee || 0) - Number(schedule.amountPaid || 0);
    return sum + Math.max(due, 0);
  }, 0);
}

async function recordStripeCheckoutPayment(session) {
  const gatewayRef = session.payment_intent || session.id;
  const existingTransaction = await Transaction.findOne({ gatewayRef });

  if (existingTransaction) {
    await updatePaymentLog(session, "confirmed", "checkout.session.completed");
    return existingTransaction;
  }

  const transaction = await recordPayment(
    {
      loanId: session.metadata.loanId,
      amount: Number(session.metadata.amountBdt),
      method: "stripe",
      allocationMode: session.metadata.allocationMode || "advance",
      gatewayRef,
      notes: "Stripe Checkout payment"
    },
    session.metadata.buyerId,
    { requireBuyerOwnership: true }
  );
  await updatePaymentLog(session, "confirmed", "checkout.session.completed", transaction._id);
  return transaction;
}

async function updatePaymentLog(session, status, eventType, transactionId) {
  return PaymentLog.findOneAndUpdate(
    { provider: "stripe", sessionId: session.id },
    {
      provider: "stripe",
      sessionId: session.id,
      paymentIntentId: session.payment_intent,
      loanId: session.metadata?.loanId,
      buyerId: session.metadata?.buyerId,
      amount: Number(session.metadata?.amountBdt || 0),
      currency: session.currency,
      status,
      eventType,
      metadata: { ...session.metadata, transactionId }
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
    const { loanId, allocationMode } = req.body;
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

    const outstandingAmount = await getOutstandingAmount(loan._id);
    if (outstandingAmount < 1) {
      const error = new Error("This loan has no payable installments");
      error.status = 400;
      throw error;
    }
    if (amount > outstandingAmount) {
      const error = new Error(`Payment cannot exceed outstanding amount BDT ${Math.round(outstandingAmount)}`);
      error.status = 400;
      throw error;
    }

    const stripe = getStripeClient();
    const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";
    const currency = (process.env.STRIPE_CURRENCY || "usd").toLowerCase();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
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
        loanId: loan._id.toString(),
        buyerId: req.user._id.toString(),
        amountBdt: String(Math.round(amount)),
        allocationMode
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
