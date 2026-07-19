import { createRequire } from "node:module";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

process.env.NODE_ENV = "test";
process.env.EMAIL_PROVIDER = "mock";
process.env.EXPOSE_EMAIL_OTP = "true";
process.env.JWT_SECRET = "registration-test-jwt-secret";
process.env.REFRESH_TOKEN_SECRET = "registration-test-refresh-secret";

const require = createRequire(import.meta.url);
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const request = require("supertest");
const app = require("../app");
const AuditLog = require("../models/AuditLog");
const BuyerProfile = require("../models/BuyerProfile");
const PendingRegistration = require("../models/PendingRegistration");
const RefreshToken = require("../models/RefreshToken");
const SellerProfile = require("../models/SellerProfile");
const User = require("../models/User");

let replicaSet;

beforeAll(async () => {
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(replicaSet.getUri());
  await Promise.all([AuditLog, BuyerProfile, PendingRegistration, RefreshToken, SellerProfile, User].map((model) => model.init()));
});

beforeEach(async () => {
  await Promise.all([AuditLog, BuyerProfile, PendingRegistration, RefreshToken, SellerProfile, User].map((model) => model.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
  await replicaSet.stop();
});

describe("email-gated registration", () => {
  it("keeps a seller pending outside User/Profile collections until OTP verification", async () => {
    const registration = await request(app).post("/api/auth/register").send({
      name: "Pending Seller",
      email: "pending-seller@example.com",
      phone: "01700000101",
      password: "Seller@123",
      role: "seller",
      shopName: "Pending Store",
      address: "Sylhet",
      tradeLicenseNo: "TR-101"
    });

    expect(registration.status).toBe(201);
    expect(registration.body.verificationRequired).toBe(true);
    expect(registration.body.pendingRegistration).toBe(true);
    expect(registration.body.mockOtp).toMatch(/^\d{6}$/);
    expect(await User.countDocuments()).toBe(0);
    expect(await SellerProfile.countDocuments()).toBe(0);
    expect(await PendingRegistration.countDocuments()).toBe(1);

    const pending = await PendingRegistration.findOne({ email: "pending-seller@example.com" });
    expect(pending.otpHash).not.toBe(registration.body.mockOtp);
    expect(pending.passwordHash).not.toBe("Seller@123");

    const preVerificationLogin = await request(app).post("/api/auth/login").send({
      email: "pending-seller@example.com",
      password: "Seller@123"
    });
    expect(preVerificationLogin.status).toBe(403);
    expect(preVerificationLogin.body.verificationRequired).toBe(true);

    const wrongVerification = await request(app).post("/api/auth/verify-email").send({
      email: "pending-seller@example.com",
      otp: "000000"
    });
    expect(wrongVerification.status).toBe(400);
    expect(await User.countDocuments()).toBe(0);

    const verification = await request(app).post("/api/auth/verify-email").send({
      email: "pending-seller@example.com",
      otp: registration.body.mockOtp
    });
    expect(verification.status).toBe(200);
    expect(verification.body.user).toMatchObject({
      email: "pending-seller@example.com",
      role: "seller",
      status: "pending_admin_approval",
      isVerified: true
    });

    const [user, sellerProfile] = await Promise.all([
      User.findOne({ email: "pending-seller@example.com" }),
      SellerProfile.findOne({ shopName: "Pending Store" })
    ]);
    expect(user).toBeTruthy();
    expect(sellerProfile.userId.toString()).toBe(user._id.toString());
    expect(await PendingRegistration.countDocuments()).toBe(0);

    const login = await request(app).post("/api/auth/login").send({
      email: "pending-seller@example.com",
      password: "Seller@123"
    });
    expect(login.status).toBe(200);
    expect(login.body.token).toBeTruthy();
  });

  it("creates an active buyer and buyer profile only after verification", async () => {
    const registration = await request(app).post("/api/auth/register").send({
      name: "Pending Buyer",
      email: "pending-buyer@example.com",
      phone: "+8801700000102",
      password: "Buyer@123",
      role: "buyer",
      address: "Dhaka",
      nidNumber: "NID-102"
    });

    expect(registration.status).toBe(201);
    expect(await User.countDocuments()).toBe(0);
    expect(await BuyerProfile.countDocuments()).toBe(0);

    const verification = await request(app).post("/api/auth/verify-otp").send({
      email: "pending-buyer@example.com",
      otp: registration.body.mockOtp
    });
    expect(verification.status).toBe(200);

    const buyer = await User.findOne({ email: "pending-buyer@example.com" });
    const profile = await BuyerProfile.findOne({ userId: buyer._id });
    expect(buyer).toMatchObject({ role: "buyer", status: "active", isVerified: true });
    expect(profile).toMatchObject({ address: "Dhaka", nidNumber: "NID-102" });
  });

  it("emails a random password-reset OTP and accepts it only through the reset flow", async () => {
    const user = await User.create({
      name: "Reset Buyer",
      email: "reset-buyer@example.com",
      phone: "+8801700000199",
      passwordHash: await bcrypt.hash("Buyer@123", 10),
      role: "buyer",
      status: "active",
      isVerified: true
    });

    const resetRequest = await request(app).post("/api/auth/forgot-password").send({
      email: user.email
    });
    expect(resetRequest.status).toBe(200);
    expect(resetRequest.body.mockOtp).toMatch(/^\d{6}$/);
    expect(resetRequest.body.mockOtp).not.toBe("123456");

    const stored = await User.findById(user._id);
    expect(stored.passwordResetOtpHash).not.toBe(resetRequest.body.mockOtp);
    expect(await bcrypt.compare(resetRequest.body.mockOtp, stored.passwordResetOtpHash)).toBe(true);

    const wrongReset = await request(app).post("/api/auth/reset-password").send({
      email: user.email,
      otp: "000000",
      password: "Changed@123"
    });
    expect(wrongReset.status).toBe(400);

    const reset = await request(app).post("/api/auth/reset-password").send({
      email: user.email,
      otp: resetRequest.body.mockOtp,
      password: "Changed@123"
    });
    expect(reset.status).toBe(200);

    const updated = await User.findById(user._id);
    expect(await bcrypt.compare("Changed@123", updated.passwordHash)).toBe(true);
    expect(updated.passwordResetOtpHash).toBeUndefined();
  });
});
