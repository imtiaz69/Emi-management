const Stripe = require("stripe");

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
  return Math.max(Math.round((Number(amountBdt) / exchangeRate) * 100), 50);
}

module.exports = { getStripeClient, toStripeAmount };
