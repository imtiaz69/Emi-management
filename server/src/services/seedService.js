const bcrypt = require("bcryptjs");
const User = require("../models/User");
const SellerProfile = require("../models/SellerProfile");
const BuyerProfile = require("../models/BuyerProfile");
const Product = require("../models/Product");
const { createLoanWithSchedule, recordPayment } = require("./loanService");

async function upsertUser({ name, email, phone, password, role, status = "active" }) {
  let user = await User.findOne({ email });
  if (!user) {
    user = await User.create({
      name,
      email,
      phone,
      passwordHash: await bcrypt.hash(password, 10),
      role,
      status,
      isVerified: true
    });
  }
  return user;
}

async function seedDemoData({ reset = false } = {}) {
  if (reset) {
    await Promise.all(Object.values(require("mongoose").connection.collections).map((collection) => collection.deleteMany({})));
  }

  const existing = await User.countDocuments();
  if (existing && !reset) return { skipped: true };

  const admin = await upsertUser({
    name: "System Admin",
    email: process.env.SEED_ADMIN_EMAIL || "admin@emi.local",
    phone: "01700000000",
    password: process.env.SEED_ADMIN_PASSWORD || "Admin@123",
    role: "admin"
  });

  const seller = await upsertUser({
    name: "Demo Seller",
    email: "seller@emi.local",
    phone: "01711111111",
    password: "Seller@123",
    role: "seller"
  });
  await SellerProfile.findOneAndUpdate(
    { userId: seller._id },
    {
      userId: seller._id,
      shopName: "Imtiaz Electronics",
      ownerName: "Demo Seller",
      address: "Sylhet, Bangladesh",
      businessType: "Electronics",
      tradeLicenseNo: "TL-2026-001",
      approvalStatus: "approved",
      approvedBy: admin._id,
      approvedAt: new Date()
    },
    { upsert: true }
  );

  const buyer = await upsertUser({
    name: "Demo Buyer",
    email: "buyer@emi.local",
    phone: "01722222222",
    password: "Buyer@123",
    role: "buyer"
  });
  await BuyerProfile.findOneAndUpdate({ userId: buyer._id }, { userId: buyer._id, address: "Akhalia, Sylhet", nidNumber: "1234567890" }, { upsert: true });

  const products = await Product.insertMany([
    {
      sellerId: seller._id,
      name: "Smartphone A15",
      description: "4G smartphone with EMI support",
      category: "Mobile",
      price: 22000,
      stock: 8,
      emiAvailable: true,
      emiInterestRate: 12,
      emiInterestType: "flat",
      emiMinDownPayment: 4000,
      emiMaxTenureMonths: 12,
      colors: [{ name: "Black", hex: "#111827" }, { name: "Blue", hex: "#2563eb" }]
    },
    {
      sellerId: seller._id,
      name: "LED TV 32 inch",
      description: "Energy efficient TV",
      category: "Electronics",
      price: 32000,
      stock: 2,
      emiAvailable: true,
      emiInterestRate: 10,
      emiInterestType: "reducing",
      emiMinDownPayment: 6000,
      emiMaxTenureMonths: 18,
      colors: [{ name: "Black", hex: "#020617" }]
    },
    {
      sellerId: seller._id,
      name: "Office Chair",
      description: "Comfortable chair",
      category: "Furniture",
      price: 6500,
      stock: 12,
      emiAvailable: false,
      colors: [{ name: "Gray", hex: "#6b7280" }, { name: "Brown", hex: "#92400e" }]
    }
  ]);

  const loan = await createLoanWithSchedule(
    {
      sellerId: seller._id,
      buyerId: buyer._id,
      productId: products[0]._id,
      principal: 22000,
      downPayment: 4000,
      interestRate: 12,
      interestType: "flat",
      tenureMonths: 6,
      lateFeePolicy: { type: "daily", value: 20 },
      source: "offline"
    },
    seller._id
  );

  await recordPayment({ loanId: loan._id, amount: 3000, method: "cash", notes: "Demo partial payment" }, seller._id);
  return { skipped: false };
}

module.exports = { seedDemoData };
