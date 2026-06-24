require("dotenv").config();
const mongoose = require("mongoose");
const { connectDB } = require("./config/db");
const { seedDemoData } = require("./services/seedService");

async function seed() {
  await connectDB();
  await seedDemoData({ reset: true });
  console.log("Seed complete");
  console.log("Admin:  admin@emi.local / Admin@123");
  console.log("Seller: seller@emi.local / Seller@123");
  console.log("Buyer:  buyer@emi.local / Buyer@123");
  await mongoose.disconnect();
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
