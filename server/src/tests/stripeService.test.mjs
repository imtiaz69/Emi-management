import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { toStripeAmount } = require("../services/stripeService");

const originalCurrency = process.env.STRIPE_CURRENCY;
const originalExchangeRate = process.env.STRIPE_BDT_PER_USD;
const originalAllowConversion = process.env.ALLOW_STRIPE_CURRENCY_CONVERSION;

afterEach(() => {
  if (originalCurrency === undefined) delete process.env.STRIPE_CURRENCY;
  else process.env.STRIPE_CURRENCY = originalCurrency;

  if (originalExchangeRate === undefined) delete process.env.STRIPE_BDT_PER_USD;
  else process.env.STRIPE_BDT_PER_USD = originalExchangeRate;

  if (originalAllowConversion === undefined) delete process.env.ALLOW_STRIPE_CURRENCY_CONVERSION;
  else process.env.ALLOW_STRIPE_CURRENCY_CONVERSION = originalAllowConversion;
});

describe("stripeService", () => {
  it("keeps BDT checkout amounts exact in Stripe minor units", () => {
    process.env.STRIPE_CURRENCY = "bdt";

    expect(toStripeAmount(120080)).toBe(12008000);
  });

  it("blocks silent BDT conversion by default", () => {
    process.env.STRIPE_CURRENCY = "usd";
    delete process.env.ALLOW_STRIPE_CURRENCY_CONVERSION;

    expect(() => toStripeAmount(120080)).toThrow("Stripe currency conversion is disabled");
  });

  it("converts BDT to USD only when conversion is explicitly allowed", () => {
    process.env.STRIPE_CURRENCY = "usd";
    process.env.STRIPE_BDT_PER_USD = "120";
    process.env.ALLOW_STRIPE_CURRENCY_CONVERSION = "true";

    expect(toStripeAmount(120080)).toBe(100067);
  });
});
