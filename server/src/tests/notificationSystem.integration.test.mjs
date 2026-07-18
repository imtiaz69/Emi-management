import { createRequire } from "node:module";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "notification-test-jwt-secret";

const require = createRequire(import.meta.url);
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const dayjs = require("dayjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const request = require("supertest");
const app = require("../app");
const BuyerProfile = require("../models/BuyerProfile");
const EMISchedule = require("../models/EMISchedule");
const Loan = require("../models/Loan");
const NotificationLog = require("../models/NotificationLog");
const Product = require("../models/Product");
const User = require("../models/User");
const { runOverdueCheck } = require("../jobs/overdueJob");

let replicaSet;
let buyer;
let seller;

function userToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role }, process.env.JWT_SECRET, { expiresIn: "15m" });
}

beforeAll(async () => {
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(replicaSet.getUri());
  await Promise.all([BuyerProfile, EMISchedule, Loan, NotificationLog, Product, User].map((model) => model.init()));
});

beforeEach(async () => {
  await Promise.all([BuyerProfile, EMISchedule, Loan, NotificationLog, Product, User].map((model) => model.deleteMany({})));
  buyer = await User.create({
    name: "Reminder Buyer",
    email: "reminder-buyer@test.local",
    phone: "01710000001",
    passwordHash: "test",
    role: "buyer",
    status: "active",
    isVerified: true
  });
  seller = await User.create({
    name: "Reminder Seller",
    email: "reminder-seller@test.local",
    phone: "01710000002",
    passwordHash: "test",
    role: "seller",
    status: "active",
    isVerified: true
  });
  await BuyerProfile.create({ userId: buyer._id });
});

afterAll(async () => {
  await mongoose.disconnect();
  await replicaSet.stop();
});

describe("real-time notification persistence", () => {
  it("creates every upcoming EMI milestone, stock and high-risk alerts exactly once", async () => {
    const now = new Date("2026-07-19T03:00:00.000Z");
    const product = await Product.create({
      sellerId: seller._id,
      name: "Low Stock Phone",
      sku: "LOW-2",
      price: 12000,
      stock: 2,
      lowStockThreshold: 3,
      colors: [{ name: "Black", hex: "#000000" }]
    });
    const loan = await Loan.create({
      sellerId: seller._id,
      buyerId: buyer._id,
      productId: product._id,
      principal: 12000,
      downPayment: 3000,
      interestRate: 0,
      interestType: "zero",
      tenureMonths: 6,
      totalPayable: 9000,
      status: "active"
    });
    const offsets = [7, 3, 2, 1, 0, -17];
    await EMISchedule.insertMany(
      offsets.map((offset, index) => ({
        loanId: loan._id,
        buyerId: buyer._id,
        sellerId: seller._id,
        installmentNo: index + 1,
        dueDate: dayjs(now).startOf("day").add(offset, "day").toDate(),
        principalAmount: 1500,
        interestAmount: 0,
        amountDue: 1500,
        amountPaid: 0,
        status: "pending"
      }))
    );

    const firstRun = await runOverdueCheck({ now });
    const firstCount = await NotificationLog.countDocuments();
    const secondRun = await runOverdueCheck({ now });
    const secondCount = await NotificationLog.countDocuments();

    const buyerNotifications = await NotificationLog.find({ userId: buyer._id, channel: "in_app" });
    const sellerNotifications = await NotificationLog.find({ userId: seller._id, channel: "in_app" });
    const profile = await BuyerProfile.findOne({ userId: buyer._id });

    expect(firstRun.upcomingAlerts).toBe(5);
    expect(secondRun.upcomingAlerts).toBe(5);
    expect(secondCount).toBe(firstCount);
    expect(buyerNotifications.filter((item) => item.messageType.startsWith("emi_due_"))).toHaveLength(5);
    expect(sellerNotifications.some((item) => item.messageType === "product_low_stock")).toBe(true);
    expect(sellerNotifications.some((item) => item.messageType === "high_risk_customer")).toBe(true);
    expect(profile.riskCategory).toBe("high");
  });

  it("keeps each inbox private and supports one/all read updates", async () => {
    const buyerNotification = await NotificationLog.create({
      userId: buyer._id,
      channel: "in_app",
      title: "Buyer only",
      messageType: "private_buyer",
      message: "Private buyer notification"
    });
    const sellerNotification = await NotificationLog.create({
      userId: seller._id,
      channel: "in_app",
      title: "Seller only",
      messageType: "private_seller",
      message: "Private seller notification"
    });
    await NotificationLog.create({
      userId: buyer._id,
      channel: "email",
      title: "Email log",
      messageType: "email_only",
      message: "Not part of the in-app inbox"
    });
    const token = userToken(buyer);

    const feed = await request(app).get("/api/notifications").set("Authorization", `Bearer ${token}`);
    expect(feed.status).toBe(200);
    expect(feed.body.items).toHaveLength(1);
    expect(feed.body.items[0]._id).toBe(buyerNotification._id.toString());
    expect(feed.body.unreadCount).toBe(1);

    const forbiddenRead = await request(app)
      .patch(`/api/notifications/${sellerNotification._id}/read`)
      .set("Authorization", `Bearer ${token}`);
    expect(forbiddenRead.status).toBe(404);

    const readOne = await request(app)
      .patch(`/api/notifications/${buyerNotification._id}/read`)
      .set("Authorization", `Bearer ${token}`);
    expect(readOne.status).toBe(200);
    expect(readOne.body.isRead).toBe(true);

    const markAll = await request(app).patch("/api/notifications/read-all").set("Authorization", `Bearer ${token}`);
    expect(markAll.status).toBe(200);
    expect((await NotificationLog.findById(sellerNotification._id)).isRead).toBe(false);
  });
});
