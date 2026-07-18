require("dotenv").config();
const mongoose = require("mongoose");
const Loan = require("../models/Loan");
const { ensureMarketplaceDeliveryOrder } = require("../services/loanService");

async function reconcileLegacyEmiOrders({ dryRun = false } = {}) {
  const loans = await Loan.find({
    source: "marketplace",
    status: { $in: ["active", "closed"] },
    productId: { $exists: true, $ne: null },
    $or: [{ orderId: { $exists: false } }, { orderId: null }]
  }).sort({ createdAt: 1 });

  if (dryRun) {
    return { found: loans.length, created: 0, loanIds: loans.map((loan) => loan._id.toString()) };
  }

  const createdOrderIds = [];
  for (const sourceLoan of loans) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const loan = await Loan.findById(sourceLoan._id).session(session);
        if (!loan || loan.orderId || !["active", "closed"].includes(loan.status)) return;
        const order = await ensureMarketplaceDeliveryOrder(loan, { session, readyForDelivery: true });
        if (order) createdOrderIds.push(order._id.toString());
      });
    } finally {
      await session.endSession();
    }
  }

  return { found: loans.length, created: createdOrderIds.length, orderIds: createdOrderIds };
}

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
  await mongoose.connect(process.env.MONGO_URI);
  const result = await reconcileLegacyEmiOrders({ dryRun: process.argv.includes("--dry-run") });
  console.log(JSON.stringify(result, null, 2));
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error(error.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}

module.exports = { reconcileLegacyEmiOrders };
