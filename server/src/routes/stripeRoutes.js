const express = require("express");
const Stripe = require("stripe");
const Loan = require("../models/Loan");
const EMISchedule = require("../models/EMISchedule");
const Transaction = require("../models/Transaction");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, authorize } = require("../middleware/auth");
const { recordPayment } = require("../services/loanService");

const router = express.Router();

function getStripeClient() {
  if (!process.env.STRIPE_SECRET_KEY) {
    const error = new Error("Stripe secret key is not configured");
    error.status = 500;
    throw error;
  }
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

function toStripeAmount(amountBdt) {
  const currency = (process.env.STRIPE_CURRENCY || "usd").toLowerCase();
  if (currency === "bdt") return Math.round(Number(amountBdt));

  const exchangeRate = Number(process.env.STRIPE_BDT_PER_USD || 120);
  const amountInCents = Math.round((Number(amountBdt) / exchangeRate) * 100);
  return Math.max(amountInCents, 50);
}

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

  if (existingTransaction) return existingTransaction;

  return recordPayment(
    {
      loanId: session.metadata.loanId,
      amount: Number(session.metadata.amountBdt),
      method: "stripe",
      gatewayRef,
      notes: "Stripe Checkout payment"
    },
    session.metadata.buyerId
  );
}

router.post(
  "/create-checkout-session",
  authenticate,
  authorize("buyer"),
  asyncHandler(async (req, res) => {
    const { loanId } = req.body;
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
      cancel_url: `${clientUrl}/buyer?stripe=cancel`,
      metadata: {
        loanId: loan._id.toString(),
        buyerId: req.user._id.toString(),
        amountBdt: String(Math.round(amount))
      }
    });

    res.status(201).json({ sessionId: session.id, url: session.url });
  })
);

router.post(
  "/confirm-checkout-session",
  authenticate,
  authorize("buyer"),
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
    } else {
      event = JSON.parse(req.body.toString());
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      await recordStripeCheckoutPayment(session);
    }

    res.json({ received: true });
  } catch (error) {
    next(error);
  }
}

module.exports = { stripeRouter: router, stripeWebhookHandler };
