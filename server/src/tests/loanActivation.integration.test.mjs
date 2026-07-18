import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const AuditLog = require("../models/AuditLog");
const BuyerProfile = require("../models/BuyerProfile");
const EMIApplication = require("../models/EMIApplication");
const EMISchedule = require("../models/EMISchedule");
const InventoryLedger = require("../models/InventoryLedger");
const KYCDocument = require("../models/KYCDocument");
const Loan = require("../models/Loan");
const LoanAgreement = require("../models/LoanAgreement");
const Order = require("../models/Order");
const Product = require("../models/Product");
const Shipment = require("../models/Shipment");
const Transaction = require("../models/Transaction");
const User = require("../models/User");
const { activateApprovedLoanAfterDownPayment, approveLoanRequest, recordPayment } = require("../services/loanService");

let replicaSet;

beforeAll(async () => {
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(replicaSet.getUri());
  await Promise.all(
    [AuditLog, BuyerProfile, EMIApplication, EMISchedule, InventoryLedger, KYCDocument, Loan, LoanAgreement, Order, Product, Shipment, Transaction, User].map((model) => model.init())
  );
});

afterAll(async () => {
  await mongoose.disconnect();
  await replicaSet.stop();
});

describe("approved EMI activation", () => {
  it("activates the loan and order only after one confirmed down payment", async () => {
    const buyer = await User.create({
      name: "Buyer Test",
      email: "buyer-flow@test.local",
      phone: "01700000001",
      passwordHash: "test",
      role: "buyer",
      status: "active",
      isVerified: true
    });
    const seller = await User.create({
      name: "Seller Test",
      email: "seller-flow@test.local",
      phone: "01700000002",
      passwordHash: "test",
      role: "seller",
      status: "active",
      isVerified: true
    });
    const product = await Product.create({
      sellerId: seller._id,
      name: "EMI Test Product",
      price: 10000,
      stock: 4,
      stockReserved: 1,
      emiMinDownPayment: 2000,
      emiMaxTenureMonths: 3,
      colors: [{ name: "Black", hex: "#000000" }]
    });
    const order = await Order.create({
      orderNo: "ORD-ACTIVATION-TEST",
      buyerId: buyer._id,
      sellerIds: [seller._id],
      items: [
        {
          productId: product._id,
          sellerId: seller._id,
          name: product.name,
          quantity: 1,
          unitPrice: 10000,
          totalPrice: 10000,
          financeMode: "emi",
          fulfillmentStatus: "pending"
        }
      ],
      subtotal: 10000,
      total: 10000,
      paymentMode: "emi",
      paymentStatus: "unpaid",
      fulfillmentStatus: "pending"
    });
    const loan = await Loan.create({
      sellerId: seller._id,
      buyerId: buyer._id,
      productId: product._id,
      orderId: order._id,
      orderItemId: order.items[0]._id,
      source: "marketplace",
      principal: 10000,
      downPayment: 2000,
      interestRate: 12,
      interestType: "flat",
      tenureMonths: 3,
      totalPayable: 8960,
      status: "requested"
    });
    order.items[0].loanId = loan._id;
    await order.save();
    await EMIApplication.create({
      buyerId: buyer._id,
      sellerId: seller._id,
      productId: product._id,
      orderId: order._id,
      orderItemId: order.items[0]._id,
      loanId: loan._id,
      requestedPrincipal: 10000,
      downPayment: 2000,
      tenureMonths: 3,
      interestRate: 12,
      status: "under_review"
    });

    const approvedLoan = await approveLoanRequest(loan._id, seller._id, seller._id);
    const [orderBeforePayment, schedulesBeforePayment, transactionsBeforePayment] = await Promise.all([
      Order.findById(order._id),
      EMISchedule.find({ loanId: loan._id }),
      Transaction.find({ loanId: loan._id })
    ]);
    expect(approvedLoan.status).toBe("approved");
    expect(orderBeforePayment.paymentStatus).toBe("unpaid");
    expect(orderBeforePayment.items[0].fulfillmentStatus).toBe("pending");
    expect(schedulesBeforePayment).toHaveLength(0);
    expect(transactionsBeforePayment).toHaveLength(0);

    await expect(
      activateApprovedLoanAfterDownPayment(
        { loanId: loan._id, buyerId: buyer._id, amount: 1999, method: "stripe", gatewayRef: "pi_wrong_amount" },
        buyer._id
      )
    ).rejects.toThrow("required down payment");
    expect((await Loan.findById(loan._id)).status).toBe("approved");
    expect(await Transaction.countDocuments({ loanId: loan._id })).toBe(0);

    const payment = {
      loanId: loan._id,
      buyerId: buyer._id,
      amount: 2000,
      method: "stripe",
      gatewayRef: "pi_activation_test"
    };
    const firstTransaction = await activateApprovedLoanAfterDownPayment(payment, buyer._id);
    const replayTransaction = await activateApprovedLoanAfterDownPayment(payment, buyer._id);
    const [savedLoan, savedOrder, savedProduct, schedules, transactions] = await Promise.all([
      Loan.findById(loan._id),
      Order.findById(order._id),
      Product.findById(product._id),
      EMISchedule.find({ loanId: loan._id }),
      Transaction.find({ loanId: loan._id })
    ]);

    expect(replayTransaction._id.toString()).toBe(firstTransaction._id.toString());
    expect(firstTransaction.transactionType).toBe("down_payment");
    expect(savedLoan.status).toBe("active");
    expect(savedOrder.paymentStatus).toBe("partial");
    expect(savedOrder.fulfillmentStatus).toBe("confirmed");
    expect(savedOrder.items[0].fulfillmentStatus).toBe("confirmed");
    expect(savedProduct.stockReserved).toBe(0);
    expect(schedules).toHaveLength(3);
    expect(transactions).toHaveLength(1);

    const firstTwoAmount = schedules
      .sort((a, b) => a.installmentNo - b.installmentNo)
      .slice(0, 2)
      .reduce((sum, schedule) => sum + schedule.amountDue, 0);
    const installmentTransaction = await recordPayment(
      {
        loanId: loan._id,
        amount: firstTwoAmount,
        method: "stripe",
        gatewayRef: "pi_two_installments",
        allocationMode: "next_n",
        installmentCount: 2
      },
      buyer._id,
      { requireBuyerOwnership: true }
    );
    const paidSchedules = await EMISchedule.find({ loanId: loan._id }).sort({ installmentNo: 1 });

    expect(installmentTransaction.allocations).toHaveLength(2);
    expect(installmentTransaction.allocations.map((allocation) => allocation.installmentNo)).toEqual([1, 2]);
    expect(paidSchedules.map((schedule) => schedule.status)).toEqual(["paid", "paid", "pending"]);
  });

  it("creates a delivery order when a legacy marketplace loan has no linked order", async () => {
    const buyer = await User.create({
      name: "Legacy Buyer",
      email: "legacy-buyer@test.local",
      phone: "01700000003",
      passwordHash: "test",
      role: "buyer",
      status: "active",
      isVerified: true
    });
    const seller = await User.create({
      name: "Legacy Seller",
      email: "legacy-seller@test.local",
      phone: "01700000004",
      passwordHash: "test",
      role: "seller",
      status: "active",
      isVerified: true
    });
    await BuyerProfile.create({ userId: buyer._id, address: "Zindabazar, Sylhet" });
    const product = await Product.create({
      sellerId: seller._id,
      name: "Legacy EMI Product",
      price: 15000,
      stock: 3,
      stockReserved: 0,
      colors: [{ name: "Blue", hex: "#2563eb" }]
    });
    const loan = await Loan.create({
      sellerId: seller._id,
      buyerId: buyer._id,
      productId: product._id,
      source: "marketplace",
      principal: 15000,
      downPayment: 3000,
      interestRate: 0,
      interestType: "zero",
      tenureMonths: 3,
      totalPayable: 12000,
      status: "requested",
      selectedColorName: "Blue",
      selectedColorHex: "#2563eb"
    });

    await approveLoanRequest(loan._id, seller._id, seller._id);
    await activateApprovedLoanAfterDownPayment(
      {
        loanId: loan._id,
        buyerId: buyer._id,
        amount: 3000,
        method: "stripe",
        gatewayRef: "pi_legacy_activation"
      },
      buyer._id
    );

    const [savedLoan, order, shipment, savedProduct] = await Promise.all([
      Loan.findById(loan._id),
      Order.findOne({ "items.loanId": loan._id }),
      Shipment.findOne({ sellerId: seller._id }),
      Product.findById(product._id)
    ]);
    expect(savedLoan.orderId.toString()).toBe(order._id.toString());
    expect(savedLoan.orderItemId.toString()).toBe(order.items[0]._id.toString());
    expect(order.paymentMode).toBe("emi");
    expect(order.paymentStatus).toBe("partial");
    expect(order.fulfillmentStatus).toBe("confirmed");
    expect(order.shippingAddress.line1).toBe("Zindabazar, Sylhet");
    expect(shipment.orderId.toString()).toBe(order._id.toString());
    expect(shipment.status).toBe("pending");
    expect(savedProduct.stock).toBe(2);
  });
});
