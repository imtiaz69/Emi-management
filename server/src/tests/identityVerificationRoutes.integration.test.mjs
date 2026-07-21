import { createRequire } from "node:module";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "identity-route-test-jwt-secret";
process.env.PUBLIC_CLIENT_URL = "https://client.test";

const require = createRequire(import.meta.url);
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const request = require("supertest");
const app = require("../app");
const AuditLog = require("../models/AuditLog");
const BuyerProfile = require("../models/BuyerProfile");
const IdentityVerificationResult = require("../models/IdentityVerificationResult");
const IdentityVerificationSession = require("../models/IdentityVerificationSession");
const KYCDocument = require("../models/KYCDocument");
const Loan = require("../models/Loan");
const NotificationLog = require("../models/NotificationLog");
const Order = require("../models/Order");
const User = require("../models/User");
const { completeProcessing } = require("../services/identityVerificationService");

const models = [AuditLog, BuyerProfile, IdentityVerificationResult, IdentityVerificationSession, KYCDocument, Loan, NotificationLog, Order, User];

let replicaSet;
let seller;
let buyer;
let unrelatedBuyer;

function auth(user) {
  return `Bearer ${jwt.sign({ sub: user._id.toString(), role: user.role }, process.env.JWT_SECRET, { expiresIn: "15m" })}`;
}

beforeAll(async () => {
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(replicaSet.getUri());
  await Promise.all(models.map((model) => model.init()));
});

beforeEach(async () => {
  await Promise.all(models.map((model) => model.deleteMany({})));
  [seller, buyer, unrelatedBuyer] = await User.create([
    { name: "Identity Seller", email: "identity-seller@test.local", phone: "01720000001", passwordHash: "test", role: "seller", status: "active", isVerified: true },
    { name: "Related Buyer", email: "identity-buyer@test.local", phone: "01720000002", passwordHash: "test", role: "buyer", status: "active", isVerified: true },
    { name: "Unrelated Buyer", email: "identity-other@test.local", phone: "01720000003", passwordHash: "test", role: "buyer", status: "active", isVerified: true }
  ]);
  await Loan.create({ sellerId: seller._id, buyerId: buyer._id, principal: 12000, downPayment: 2000, tenureMonths: 3, totalPayable: 10000, status: "requested" });
  await BuyerProfile.create([
    { userId: buyer._id, address: "Sylhet", nidNumber: "1234567890", dateOfBirth: "1998-05-15", emergencyContactPhone: "01700000000", monthlyIncome: 30000, occupation: "Engineer", employmentType: "salaried" },
    { userId: unrelatedBuyer._id, address: "Dhaka", nidNumber: "9876543210", dateOfBirth: "1997-04-12", emergencyContactPhone: "01800000000", monthlyIncome: 25000, occupation: "Teacher", employmentType: "salaried" }
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await replicaSet.stop();
});

describe("identity verification session routes", () => {
  it("creates and exchanges a one-time link for a related buyer", async () => {
    const created = await request(app)
      .post("/api/identity-verifications")
      .set("Authorization", auth(seller))
      .send({ buyerId: buyer._id.toString() });
    expect(created.status).toBe(201);
    expect(created.body.mobileUrl).toMatch(/^https:\/\/client\.test\/verify\/mobile#/);

    const linkToken = created.body.mobileUrl.split("#")[1];
    const firstExchange = await request(app).post("/api/identity-verifications/mobile/exchange").send({ token: linkToken });
    const replayExchange = await request(app).post("/api/identity-verifications/mobile/exchange").send({ token: linkToken });
    expect(firstExchange.status).toBe(200);
    expect(firstExchange.body.uploadToken).toHaveLength(43);
    expect(firstExchange.body.session.status).toBe("CAPTURING");
    expect(replayExchange.status).toBe(410);
  });

  it("prevents a seller from opening a session for an unrelated buyer", async () => {
    const response = await request(app)
      .post("/api/identity-verifications")
      .set("Authorization", auth(seller))
      .send({ buyerId: unrelatedBuyer._id.toString() });
    expect(response.status).toBe(403);
  });

  it("lets a verified buyer create a private document-only NID session", async () => {
    const created = await request(app)
      .post("/api/identity-verifications/buyer/start")
      .set("Authorization", auth(buyer));
    expect(created.status).toBe(201);
    expect(created.body.uploadToken).toHaveLength(43);
    expect(created.body.session.verificationType).toBe("nid_cross_check");
    expect(created.body.session.captureMode).toBe("document_only");

    const ownerView = await request(app)
      .get(`/api/identity-verifications/buyer/${created.body.session._id}`)
      .set("Authorization", auth(buyer));
    const otherView = await request(app)
      .get(`/api/identity-verifications/buyer/${created.body.session._id}`)
      .set("Authorization", auth(unrelatedBuyer));
    expect(ownerView.status).toBe(200);
    expect(otherView.status).toBe(404);
  });

  it("blocks NID upload sessions until the buyer profile is complete", async () => {
    await BuyerProfile.updateOne({ userId: buyer._id }, { $set: { dateOfBirth: "" } });
    const response = await request(app)
      .post("/api/identity-verifications/buyer/start")
      .set("Authorization", auth(buyer));
    expect(response.status).toBe(400);
    expect(response.body.message).toContain("Complete your buyer profile");
    expect(response.body.missingFields).toContain("date of birth");
  });

  it("automatically approves linked KYC only after every required check passes", async () => {
    const kyc = await KYCDocument.create({ userId: buyer._id, sellerId: seller._id, type: "nid", files: [], verificationMethod: "identity_cross_validation" });
    const session = await IdentityVerificationSession.create({
      buyerId: buyer._id,
      initiatedBy: seller._id,
      initiatorRole: "seller",
      sellerId: seller._id,
      kycDocumentId: kyc._id,
      linkTokenHash: "a".repeat(64),
      expiresAt: new Date(Date.now() + 60_000),
      status: "PROCESSING",
      captureMode: "video",
      challenge: ["BLINK", "TURN_LEFT", "TURN_RIGHT"]
    });
    const result = await completeProcessing(session, {
      ocr: { status: "COMPLETED", rawText: "sensitive", fields: { name: "TEST BUYER", nidNumber: "1234567890", dateOfBirth: "1998-05-15" }, confidence: 0.95, warnings: [] },
      qr: { status: "DECODED", rawData: "sensitive", fields: { name: "Test Buyer", nidNumber: "1234567890", dateOfBirth: "1998-05-15" } },
      comparisons: { nameSimilarity: 1 },
      face: { detected: true, qualityAcceptable: true, similarity: 0.8, warnings: [] },
      liveness: { status: "PASS", warnings: [] }
    });
    const savedKyc = await KYCDocument.findById(kyc._id);
    expect(result.overallStatus).toBe("VERIFIED");
    expect(savedKyc.status).toBe("approved");
    expect(savedKyc.automatedVerification.resultId.toString()).toBe(result._id.toString());
  });

  it("rejects linked NID KYC with a clear reason when the front and profile differ", async () => {
    const kyc = await KYCDocument.create({ userId: buyer._id, type: "nid", files: [], verificationMethod: "identity_cross_validation" });
    const session = await IdentityVerificationSession.create({
      buyerId: buyer._id,
      initiatedBy: buyer._id,
      initiatorRole: "buyer",
      verificationType: "nid_cross_check",
      kycDocumentId: kyc._id,
      expiresAt: new Date(Date.now() + 60_000),
      status: "PROCESSING",
      captureMode: "document_only"
    });
    const result = await completeProcessing(session, {
      ocr: { status: "COMPLETED", rawText: "sensitive", fields: { name: "TEST BUYER", nidNumber: "9999999999", dateOfBirth: "1998-05-15" }, confidence: 0.95, warnings: [] },
      qr: { status: "NOT_REQUIRED", rawData: "", fields: {} },
      comparisons: { nameSimilarity: 1 },
      face: { detected: false, qualityAcceptable: false, similarity: 0, warnings: [] },
      liveness: { status: "NOT_AVAILABLE", warnings: [] }
    });
    const savedKyc = await KYCDocument.findById(kyc._id);
    expect(result.overallStatus).toBe("FAILED");
    expect(savedKyc.status).toBe("rejected");
    expect(savedKyc.rejectionReason).toContain("NID number");
  });

  it("does not treat a pending upload as EMI-ready KYC", async () => {
    await BuyerProfile.updateOne({ userId: buyer._id }, { $set: {
      address: "Sylhet",
      nidNumber: "1234567890",
      dateOfBirth: "1998-05-15",
      emergencyContactPhone: "01700000000",
      monthlyIncome: 30000,
      occupation: "Engineer",
      employmentType: "salaried"
    } });
    await KYCDocument.create({ userId: buyer._id, type: "nid", files: [], status: "pending", verificationMethod: "identity_cross_validation" });
    const pending = await request(app).get("/api/buyer/profile").set("Authorization", auth(buyer));
    expect(pending.body.readiness.ready).toBe(false);
    expect(pending.body.readiness.hasKyc).toBe(false);

    await KYCDocument.updateMany({ userId: buyer._id }, { status: "approved" });
    const approved = await request(app).get("/api/buyer/profile").set("Authorization", auth(buyer));
    expect(approved.body.readiness.ready).toBe(true);
    expect(approved.body.readiness.hasKyc).toBe(true);
  });

  it("uses the latest NID verification instead of an older approval", async () => {
    await KYCDocument.create({ userId: buyer._id, type: "nid", files: [], status: "approved", verificationMethod: "identity_cross_validation", createdAt: new Date("2026-01-01") });
    await KYCDocument.create({ userId: buyer._id, type: "nid", files: [], status: "rejected", verificationMethod: "identity_cross_validation", createdAt: new Date("2026-02-01"), rejectionReason: "QR data mismatch" });
    const response = await request(app).get("/api/buyer/profile").set("Authorization", auth(buyer));
    expect(response.body.readiness.hasKyc).toBe(false);
    expect(response.body.readiness.ready).toBe(false);
  });

  it("protects the internal AI artifact gateway with the service secret", async () => {
    const response = await request(app).get(`/api/identity-verifications/ai-assets/${buyer._id}/front`);
    expect(response.status).toBe(401);
  });
});
