import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "report-routes-test-jwt-secret";
process.env.REFRESH_TOKEN_SECRET = "report-routes-test-refresh-secret";

const require = createRequire(import.meta.url);
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const request = require("supertest");
const app = require("../app");
const Loan = require("../models/Loan");
const Order = require("../models/Order");
const SellerProfile = require("../models/SellerProfile");
const User = require("../models/User");
const { signToken } = require("../utils/tokens");

let memoryServer;
let seller;
let sellerToken;

beforeAll(async () => {
  memoryServer = await MongoMemoryServer.create();
  await mongoose.connect(memoryServer.getUri());
  await Promise.all([Loan, Order, SellerProfile, User].map((model) => model.init()));

  const [buyer, otherSeller] = await User.create([
    {
      name: "Report Buyer",
      email: "report-buyer@example.com",
      phone: "+8801700000201",
      passwordHash: "test",
      role: "buyer",
      status: "active",
      isVerified: true
    },
    {
      name: "Other Seller",
      email: "other-report-seller@example.com",
      phone: "+8801700000202",
      passwordHash: "test",
      role: "seller",
      status: "active",
      isVerified: true
    }
  ]);
  seller = await User.create({
    name: "Report Seller",
    email: "report-seller@example.com",
    phone: "+8801700000203",
    passwordHash: "test",
    role: "seller",
    status: "active",
    isVerified: true
  });
  sellerToken = signToken(seller);
  await SellerProfile.create({
    userId: seller._id,
    shopName: "Scoped Report Store",
    ownerName: seller.name,
    address: "Sylhet",
    approvalStatus: "approved"
  });

  await Order.create({
    orderNo: "ORD-REPORT-SCOPE",
    buyerId: buyer._id,
    sellerIds: [seller._id, otherSeller._id],
    items: [
      {
        productId: new mongoose.Types.ObjectId(),
        sellerId: seller._id,
        name: "Seller Product",
        quantity: 1,
        unitPrice: 10000,
        totalPrice: 10000,
        financeMode: "cash",
        fulfillmentStatus: "delivered"
      },
      {
        productId: new mongoose.Types.ObjectId(),
        sellerId: otherSeller._id,
        name: "Other Product",
        quantity: 1,
        unitPrice: 20000,
        totalPrice: 20000,
        financeMode: "cash",
        fulfillmentStatus: "delivered"
      }
    ],
    subtotal: 30000,
    discount: 3000,
    deliveryCharge: 500,
    total: 27500,
    paymentMode: "cash",
    paymentStatus: "paid",
    fulfillmentStatus: "delivered"
  });
  await Loan.create({
    sellerId: seller._id,
    buyerId: buyer._id,
    source: "offline",
    principal: 12000,
    downPayment: 2000,
    interestRate: 10,
    interestType: "flat",
    tenureMonths: 3,
    totalPayable: 11000,
    status: "active"
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await memoryServer.stop();
});

describe("report preview and exports", () => {
  it("uses seller-scoped cash value and full EMI contract value", async () => {
    const response = await request(app)
      .get("/api/reports/preview?type=sales")
      .set("Authorization", `Bearer ${sellerToken}`);

    expect(response.status).toBe(200);
    expect(response.body.count).toBe(2);
    expect(response.body.summaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Recognized sales", value: 21000 }),
        expect.objectContaining({ label: "Cash product sales", value: 9000 }),
        expect.objectContaining({ label: "EMI principal", value: 12000 })
      ])
    );
    const emiRow = response.body.rows.find((row) => row.saleType === "EMI");
    expect(emiRow.contractValue).toBe(13000);
    expect(response.body.rows.find((row) => row.saleType === "Cash").principal).toBe(9000);
  });

  it("delivers the same report as a valid PDF", async () => {
    const response = await request(app)
      .get("/api/reports/export?type=sales&format=pdf")
      .set("Authorization", `Bearer ${sellerToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/pdf");
    expect(response.headers["content-disposition"]).toContain("financelend-sales-all-time.pdf");
    expect(response.body.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("rejects an inverted reporting period", async () => {
    const response = await request(app)
      .get("/api/reports/preview?type=sales&from=2026-07-20&to=2026-07-01")
      .set("Authorization", `Bearer ${sellerToken}`);

    expect(response.status).toBe(400);
    expect(response.body.message).toContain("start date");
  });
});
