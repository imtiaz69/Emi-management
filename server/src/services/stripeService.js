const Stripe = require("stripe");

const ZERO_DECIMAL_CURRENCIES = new Set([
  "bif",
  "clp",
  "djf",
  "gnf",
  "jpy",
  "kmf",
  "krw",
  "mga",
  "pyg",
  "rwf",
  "ugx",
  "vnd",
  "vuv",
  "xaf",
  "xof",
  "xpf"
]);

function getStripeClient() {
  if (!process.env.STRIPE_SECRET_KEY) {
    const error = new Error("Stripe secret key is not configured");
    error.status = 500;
    throw error;
  }
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

function getStripeCurrency() {
  return (process.env.STRIPE_CURRENCY || "bdt").toLowerCase();
}

function assertCurrencyConversionAllowed(currency) {
  if (currency === "bdt" || process.env.ALLOW_STRIPE_CURRENCY_CONVERSION === "true") return;

  const error = new Error("Stripe currency conversion is disabled. Set STRIPE_CURRENCY=bdt so Stripe charges the exact BDT amount shown to the buyer.");
  error.status = 500;
  throw error;
}

function toStripeAmount(amountBdt) {
  const currency = getStripeCurrency();
  if (currency === "bdt") return Math.round(Number(amountBdt) * 100);
  assertCurrencyConversionAllowed(currency);

  const exchangeRate = Number(process.env.STRIPE_BDT_PER_USD || 120);
  const convertedAmount = Number(amountBdt) / exchangeRate;
  const multiplier = ZERO_DECIMAL_CURRENCIES.has(currency) ? 1 : 100;
  return Math.max(Math.round(convertedAmount * multiplier), 50);
}

module.exports = { getStripeClient, getStripeCurrency, toStripeAmount };
