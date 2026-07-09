const InventoryLedger = require("../models/InventoryLedger");

async function writeInventoryEntry({ product, type, quantity, referenceType, referenceId, note }, { session } = {}) {
  await InventoryLedger.create(
    [
      {
        productId: product._id,
        sellerId: product.sellerId,
        type,
        quantity,
        referenceType,
        referenceId,
        note
      }
    ],
    { session }
  );
}

async function reserveStock(product, quantity, referenceType, referenceId, { session, note } = {}) {
  if (product.stock < quantity) throw new Error(`${product.name} does not have enough available stock`);
  product.stock -= quantity;
  product.stockReserved = Number(product.stockReserved || 0) + quantity;
  await product.save({ session });
  await writeInventoryEntry({ product, type: "reservation", quantity: -quantity, referenceType, referenceId, note }, { session });
}

async function releaseReservation(product, quantity, referenceType, referenceId, { session, note } = {}) {
  product.stock += quantity;
  product.stockReserved = Math.max(0, Number(product.stockReserved || 0) - quantity);
  await product.save({ session });
  await writeInventoryEntry({ product, type: "cancel_release", quantity, referenceType, referenceId, note }, { session });
}

async function convertReservationToSale(product, quantity, referenceType, referenceId, { session, note } = {}) {
  product.stockReserved = Math.max(0, Number(product.stockReserved || 0) - quantity);
  await product.save({ session });
  await writeInventoryEntry({ product, type: "sale", quantity: -quantity, referenceType, referenceId, note }, { session });
}

module.exports = { convertReservationToSale, releaseReservation, reserveStock, writeInventoryEntry };
