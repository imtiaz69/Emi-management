const express = require("express");
const mongoose = require("mongoose");
const BuyerProfile = require("../models/BuyerProfile");
const EMISchedule = require("../models/EMISchedule");
const KYCDocument = require("../models/KYCDocument");
const Loan = require("../models/Loan");
const Order = require("../models/Order");
const Product = require("../models/Product");
const SellerProfile = require("../models/SellerProfile");
const Transaction = require("../models/Transaction");
const User = require("../models/User");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate, authorize } = require("../middleware/auth");

const router = express.Router();

router.get(
  "/sellers/:sellerId",
  asyncHandler(async (req, res) => {
    const { sellerId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(sellerId)) return res.status(400).json({ message: "Invalid seller identifier" });

    const seller = await User.findOne({ _id: sellerId, role: "seller", status: "active" }).select("name email phone createdAt status").lean();
    if (!seller) return res.status(404).json({ message: "Seller store not found" });

    const [profile, products, productStats] = await Promise.all([
      SellerProfile.findOne({ userId: sellerId }).select("-tradeLicenseNo -rejectionReason").lean(),
      Product.find({ sellerId, status: "active" }).sort({ featured: -1, createdAt: -1 }).limit(80).lean(),
      Product.aggregate([
        { $match: { sellerId: new mongoose.Types.ObjectId(sellerId), status: "active" } },
        {
          $group: {
            _id: null,
            totalProducts: { $sum: 1 },
            emiProducts: { $sum: { $cond: ["$emiAvailable", 1, 0] } },
            totalStock: { $sum: "$stock" },
            categories: { $addToSet: "$category" },
            minPrice: { $min: "$price" },
            maxPrice: { $max: "$price" }
          }
        }
      ])
    ]);

    const stats = productStats[0] || {
      totalProducts: 0,
      emiProducts: 0,
      totalStock: 0,
      categories: [],
      minPrice: 0,
      maxPrice: 0
    };

    res.json({
      seller,
      profile,
      stats: {
        totalProducts: stats.totalProducts || 0,
        emiProducts: stats.emiProducts || 0,
        totalStock: stats.totalStock || 0,
        categories: (stats.categories || []).filter(Boolean).sort(),
        minPrice: stats.minPrice || 0,
        maxPrice: stats.maxPrice || 0
      },
      products
    });
  })
);

router.get(
  "/buyers/:buyerId/trust",
  authenticate,
  authorize("seller", "admin"),
  asyncHandler(async (req, res) => {
    const { buyerId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(buyerId)) return res.status(400).json({ message: "Invalid buyer identifier" });

    const buyer = await User.findOne({ _id: buyerId, role: "buyer" }).select("name email phone status isVerified createdAt lastLoginAt").lean();
    if (!buyer) return res.status(404).json({ message: "Buyer not found" });

    const sellerFilter = req.user.role === "seller" ? { sellerId: req.user._id } : {};
    if (req.user.role === "seller") {
      const [hasLoan, hasOrder] = await Promise.all([
        Loan.exists({ ...sellerFilter, buyerId }),
        Order.exists({ sellerIds: req.user._id, buyerId })
      ]);
      if (!hasLoan && !hasOrder) {
        return res.status(403).json({ message: "This buyer does not have a relationship with your shop" });
      }
    }

    const scopedLoanFilter = { ...sellerFilter, buyerId };
    const scopedScheduleFilter = { ...sellerFilter, buyerId };
    const scopedTransactionFilter = { ...sellerFilter, buyerId };
    const scopedOrderFilter = req.user.role === "seller" ? { buyerId, sellerIds: req.user._id } : { buyerId };

    const [profile, kycDocuments, loans, schedules, transactions, orders] = await Promise.all([
      BuyerProfile.findOne({ userId: buyerId }).lean(),
      KYCDocument.find({ userId: buyerId }).select("type status reviewedAt rejectionReason createdAt files selfie").sort({ createdAt: -1 }).lean(),
      Loan.find(scopedLoanFilter).populate("productId", "name price category images").sort({ createdAt: -1 }).limit(50).lean(),
      EMISchedule.find(scopedScheduleFilter).sort({ dueDate: 1 }).lean(),
      Transaction.find(scopedTransactionFilter).populate("loanId", "_id productId status").populate("orderId", "orderNo").sort({ paymentDate: -1 }).limit(25).lean(),
      Order.find(scopedOrderFilter).select("orderNo total paymentMode paymentStatus fulfillmentStatus createdAt items").sort({ createdAt: -1 }).limit(25).lean()
    ]);
    const latestKyc = kycDocuments[0];

    const openSchedules = schedules.filter((schedule) => ["pending", "partial", "overdue"].includes(schedule.status));
    const overdueSchedules = schedules.filter((schedule) => schedule.status === "overdue");
    const paidSchedules = schedules.filter((schedule) => schedule.status === "paid");
    const confirmedTransactions = transactions.filter((transaction) => transaction.status === "confirmed");
    const outstandingAmount = openSchedules.reduce((sum, schedule) => sum + scheduleBalance(schedule), 0);
    const overdueAmount = overdueSchedules.reduce((sum, schedule) => sum + scheduleBalance(schedule), 0);
    const paidAmount = confirmedTransactions.reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
    const orderTotal = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);

    res.json({
      buyer,
      profile: profile
        ? {
            address: profile.address,
            nidMasked: maskSensitive(profile.nidNumber),
            emergencyContactName: profile.emergencyContactName,
            emergencyContactPhone: profile.emergencyContactPhone,
            monthlyIncome: profile.monthlyIncome,
            occupation: profile.occupation,
            employmentType: profile.employmentType,
            riskScore: profile.riskScore,
            riskCategory: profile.riskCategory,
            profilePhoto: profile.profilePhoto?.path ? sanitizeFile(profile.profilePhoto, `/api/buyer/profile-photo/${buyerId}`) : undefined
          }
        : null,
      kyc: latestKyc
        ? {
            type: latestKyc.type,
            status: latestKyc.status,
            uploadedAt: latestKyc.createdAt,
            reviewedAt: latestKyc.reviewedAt,
            rejectionReason: latestKyc.rejectionReason
          }
        : null,
      kycDocuments: kycDocuments.map(sanitizeKycDocument),
      stats: {
        totalLoans: loans.length,
        activeLoans: loans.filter((loan) => loan.status === "active").length,
        requestedLoans: loans.filter((loan) => loan.status === "requested").length,
        closedLoans: loans.filter((loan) => loan.status === "closed").length,
        defaultedLoans: loans.filter((loan) => loan.status === "defaulted").length,
        totalPrincipal: loans.reduce((sum, loan) => sum + Number(loan.principal || 0), 0),
        totalPayable: loans.reduce((sum, loan) => sum + Number(loan.totalPayable || 0), 0),
        outstandingAmount,
        overdueAmount,
        overdueInstallments: overdueSchedules.length,
        paidInstallments: paidSchedules.length,
        paidAmount,
        orderCount: orders.length,
        orderTotal,
        deliveredOrders: orders.filter((order) => order.fulfillmentStatus === "delivered").length,
        nextDue: openSchedules[0] || null
      },
      loans: loans.slice(0, 10),
      payments: transactions.slice(0, 10),
      orders: orders.slice(0, 10)
    });
  })
);

function scheduleBalance(schedule) {
  return Math.max(Number(schedule.amountDue || 0) + Number(schedule.lateFee || 0) - Number(schedule.amountPaid || 0), 0);
}

function maskSensitive(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= 4) return "****";
  return `${"*".repeat(Math.max(text.length - 4, 4))}${text.slice(-4)}`;
}

function sanitizeKycDocument(doc) {
  const id = doc._id?.toString();
  return {
    _id: id,
    type: doc.type,
    status: doc.status,
    uploadedAt: doc.createdAt,
    reviewedAt: doc.reviewedAt,
    rejectionReason: doc.rejectionReason,
    files: (doc.files || []).map((file, index) => sanitizeFile(file, `/api/kyc/${id}/files/${index}`)),
    selfie: doc.selfie ? sanitizeFile(doc.selfie, `/api/kyc/${id}/files/selfie`) : undefined
  };
}

function sanitizeFile(file, downloadUrl) {
  return {
    originalName: file.originalName,
    filename: file.filename,
    mimetype: file.mimetype,
    size: file.size,
    downloadUrl
  };
}

module.exports = router;
