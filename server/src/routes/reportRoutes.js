const dayjs = require("dayjs");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const express = require("express");
const Loan = require("../models/Loan");
const Product = require("../models/Product");
const EMISchedule = require("../models/EMISchedule");
const Transaction = require("../models/Transaction");
const Order = require("../models/Order");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate } = require("../middleware/auth");
const { validateQuery, z } = require("../middleware/validate");
const { calculateRiskScore, riskCategoryFromDays, roundMoney } = require("../services/emiService");

const router = express.Router();
router.use(authenticate);
const dateFilterSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional()
});
const exportQuerySchema = dateFilterSchema.extend({
  type: z.enum(["collections", "overdue", "sales", "orders", "emi-portfolio", "down-payments"]).optional().default("collections"),
  format: z.enum(["excel", "pdf"]).optional().default("excel")
});

router.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const scope = scopeFilter(req);
    const now = new Date();
    const activeEmis = await Loan.countDocuments({ ...scope.loan, status: "active" });
    const dueSchedules = await EMISchedule.find({ ...scope.schedule, status: { $in: ["pending", "partial", "overdue"] } });
    const dueAmount = dueSchedules.reduce((sum, row) => sum + Math.max(0, row.amountDue + row.lateFee - row.amountPaid), 0);
    const overdueSchedules = dueSchedules.filter((row) => row.dueDate < now);
    const overdueCount = overdueSchedules.length;
    const totalOverdueAmount = overdueSchedules.reduce((sum, row) => sum + Math.max(0, row.amountDue + row.lateFee - row.amountPaid), 0);
    const monthStart = dayjs().startOf("month").toDate();
    const collections = await Transaction.find({ ...scope.transaction, paymentDate: { $gte: monthStart } });
    const monthlyCollection = collections.reduce((sum, row) => sum + row.amount, 0);
    const allCollections = await Transaction.find(scope.transaction).select("amount");
    const totalCollection = allCollections.reduce((sum, row) => sum + row.amount, 0);
    const saleLoans = await Loan.find({ ...scope.loan, status: { $in: ["active", "closed", "defaulted"] } }).select("principal");
    const totalSales = saleLoans.reduce((sum, row) => sum + row.principal, 0);
    const requestedLoansCount = req.user.role === "seller" ? await Loan.countDocuments({ sellerId: req.user._id, status: "requested" }) : 0;
    const lowStockProducts = req.user.role === "seller" ? await Product.find({ sellerId: req.user._id, $expr: { $lte: ["$stock", "$lowStockThreshold"] }, status: "active" }) : [];
    res.json({
      activeEmis,
      dueAmount: roundMoney(dueAmount),
      overdueCount,
      monthlyCollection: roundMoney(monthlyCollection),
      totalCollection: roundMoney(totalCollection),
      totalOverdueAmount: roundMoney(totalOverdueAmount),
      totalSales: roundMoney(totalSales),
      requestedLoansCount,
      lowStockProducts
    });
  })
);

router.get(
  "/collections",
  validateQuery(dateFilterSchema),
  asyncHandler(async (req, res) => {
    const query = { ...scopeFilter(req).transaction };
    applyDateRange(query, req.validatedQuery, "paymentDate");
    const rows = await Transaction.find(query).populate("buyerId", "name phone").populate("loanId").sort({ paymentDate: -1 });
    res.json(rows);
  })
);

router.get(
  "/overdue",
  asyncHandler(async (req, res) => {
    const rows = await EMISchedule.find({ ...scopeFilter(req).schedule, status: { $in: ["pending", "partial", "overdue"] }, dueDate: { $lt: new Date() } })
      .populate("buyerId", "name phone email")
      .populate({ path: "loanId", populate: { path: "productId", select: "name price" } })
      .sort({ dueDate: 1 });
    const loanIds = [...new Set(rows.map((row) => row.loanId?._id?.toString()).filter(Boolean))];
    const scheduleStats = new Map();
    await Promise.all(
      loanIds.map(async (loanId) => {
        const schedules = await EMISchedule.find({ loanId }).select("amountDue");
        const totalEmis = schedules.length;
        const averageEmi = totalEmis ? schedules.reduce((sum, schedule) => sum + schedule.amountDue, 0) / totalEmis : 0;
        scheduleStats.set(loanId, { totalEmis, averageEmi });
      })
    );

    res.json(
      rows.map((row) => {
        const daysOverdue = dayjs().diff(dayjs(row.dueDate), "day");
        const balance = Math.max(0, row.amountDue + row.lateFee - row.amountPaid);
        const stats = scheduleStats.get(row.loanId?._id?.toString()) || {};
        return {
          ...row.toObject(),
          daysOverdue,
          riskCategory: riskCategoryFromDays(daysOverdue),
          riskScore: calculateRiskScore({
            overdueAmount: balance,
            totalDaysOverdue: daysOverdue,
            totalEmis: stats.totalEmis,
            averageEmi: stats.averageEmi
          }),
          balance: roundMoney(balance)
        };
      })
    );
  })
);

router.get(
  "/export",
  validateQuery(exportQuerySchema),
  asyncHandler(async (req, res) => {
    const type = req.validatedQuery.type || "collections";
    const format = req.validatedQuery.format || "excel";
    const rows = await getReportRows(req, type);

    if (format === "pdf") return exportPdf(res, type, rows);
    return exportExcel(res, type, rows);
  })
);

router.get(
  "/sales",
  validateQuery(dateFilterSchema),
  asyncHandler(async (req, res) => {
    const query = { ...scopeFilter(req).loan, status: { $in: ["active", "closed", "defaulted"] } };
    applyDateRange(query, req.validatedQuery, "createdAt");
    const loans = await Loan.find(query).populate("productId", "name category price").sort({ createdAt: -1 }).limit(1000);
    const rows = loans.map((loan) => ({
      date: loan.createdAt,
      product: loan.productId?.name || "Offline/custom loan",
      category: loan.productId?.category || "Custom",
      principal: loan.principal,
      downPayment: loan.downPayment,
      totalPayable: loan.totalPayable,
      status: loan.status
    }));
    res.json({ rows, totals: sumRows(rows, ["principal", "downPayment", "totalPayable"]) });
  })
);

router.get(
  "/emi-portfolio",
  asyncHandler(async (req, res) => {
    const loans = await Loan.find(scopeFilter(req).loan).populate("buyerId", "name phone").populate("productId", "name category").sort({ createdAt: -1 }).limit(1000);
    const rows = await Promise.all(loans.map(async (loan) => {
      const schedules = await EMISchedule.find({ loanId: loan._id });
      const outstanding = schedules.reduce((sum, row) => sum + Math.max(0, row.amountDue + row.lateFee - row.amountPaid), 0);
      return {
        loanId: loan._id,
        buyer: loan.buyerId?.name || "",
        product: loan.productId?.name || "Offline/custom loan",
        principal: loan.principal,
        totalPayable: loan.totalPayable,
        outstanding: roundMoney(outstanding),
        status: loan.status
      };
    }));
    res.json({ rows, totals: sumRows(rows, ["principal", "totalPayable", "outstanding"]) });
  })
);

router.get(
  "/orders",
  validateQuery(dateFilterSchema),
  asyncHandler(async (req, res) => {
    const query = {};
    if (req.user.role === "seller") query.sellerIds = req.user._id;
    if (req.user.role === "buyer") query.buyerId = req.user._id;
    applyDateRange(query, req.validatedQuery, "createdAt");
    const rows = await Order.find(query).populate("buyerId", "name phone").sort({ createdAt: -1 }).limit(1000);
    res.json({
      rows,
      totals: {
        orderCount: rows.length,
        orderTotal: roundMoney(rows.reduce((sum, row) => sum + row.total, 0)),
        delivered: rows.filter((row) => row.fulfillmentStatus === "delivered").length,
        pending: rows.filter((row) => row.fulfillmentStatus === "pending").length
      }
    });
  })
);

router.get(
  "/down-payments",
  validateQuery(dateFilterSchema),
  asyncHandler(async (req, res) => {
    const query = { ...scopeFilter(req).transaction, transactionType: "down_payment" };
    applyDateRange(query, req.validatedQuery, "paymentDate");
    const rows = await Transaction.find(query).populate("buyerId", "name phone").populate("loanId").sort({ paymentDate: -1 }).limit(1000);
    res.json({ rows, totals: { amount: roundMoney(rows.reduce((sum, row) => sum + row.amount, 0)) } });
  })
);

router.get(
  "/payment-methods",
  asyncHandler(async (req, res) => {
    const rows = await Transaction.aggregate([
      { $match: scopeFilter(req).transaction },
      { $group: { _id: "$method", amount: { $sum: "$amount" }, count: { $sum: 1 } } },
      { $sort: { amount: -1 } }
    ]);
    res.json(rows.map((row) => ({ method: row._id, amount: roundMoney(row.amount), count: row.count })));
  })
);

function scopeFilter(req) {
  if (req.user.role === "seller") {
    return { loan: { sellerId: req.user._id }, schedule: { sellerId: req.user._id }, transaction: { sellerId: req.user._id } };
  }
  if (req.user.role === "buyer") {
    return { loan: { buyerId: req.user._id }, schedule: { buyerId: req.user._id }, transaction: { buyerId: req.user._id } };
  }
  return { loan: {}, schedule: {}, transaction: {} };
}

function applyDateRange(query, params, field) {
  if (params.from || params.to) query[field] = { ...(params.from && { $gte: new Date(params.from) }), ...(params.to && { $lte: new Date(params.to) }) };
}

async function getOverdueRows(req) {
  return EMISchedule.find({ ...scopeFilter(req).schedule, status: { $in: ["pending", "partial", "overdue"] }, dueDate: { $lt: new Date() } })
    .populate("buyerId", "name phone")
    .limit(1000);
}

async function getReportRows(req, type) {
  if (type === "overdue") return getOverdueRows(req);
  if (type === "sales") return Loan.find({ ...scopeFilter(req).loan, status: { $in: ["active", "closed", "defaulted"] } }).populate("buyerId", "name phone").limit(1000);
  if (type === "orders") {
    const query = {};
    if (req.user.role === "seller") query.sellerIds = req.user._id;
    if (req.user.role === "buyer") query.buyerId = req.user._id;
    return Order.find(query).populate("buyerId", "name phone").limit(1000);
  }
  if (type === "emi-portfolio") return Loan.find(scopeFilter(req).loan).populate("buyerId", "name phone").limit(1000);
  if (type === "down-payments") return Transaction.find({ ...scopeFilter(req).transaction, transactionType: "down_payment" }).populate("buyerId", "name phone").limit(1000);
  return Transaction.find(scopeFilter(req).transaction).populate("buyerId", "name phone").limit(1000);
}

function sumRows(rows, fields) {
  return fields.reduce((totals, field) => ({ ...totals, [field]: roundMoney(rows.reduce((sum, row) => sum + Number(row[field] || 0), 0)) }), {});
}

async function exportExcel(res, type, rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(type);
  sheet.columns = [
    { header: "Date", key: "date", width: 18 },
    { header: "Buyer", key: "buyer", width: 24 },
    { header: "Amount", key: "amount", width: 14 },
    { header: "Status/Method", key: "status", width: 20 }
  ];
  rows.forEach((row) => {
    sheet.addRow({
      date: dayjs(row.paymentDate || row.dueDate).format("YYYY-MM-DD"),
      buyer: row.buyerId?.name || "",
      amount: row.amount || row.amountDue,
      status: row.method || row.status
    });
  });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename=${type}.xlsx`);
  await workbook.xlsx.write(res);
  res.end();
}

function exportPdf(res, type, rows) {
  const doc = new PDFDocument({ margin: 40 });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename=${type}.pdf`);
  doc.pipe(res);
  doc.fontSize(18).text(`EMI ${type} report`, { underline: true });
  doc.moveDown();
  rows.slice(0, 1000).forEach((row) => {
    doc.fontSize(10).text(`${dayjs(row.paymentDate || row.dueDate).format("YYYY-MM-DD")} | ${row.buyerId?.name || ""} | ${row.amount || row.amountDue} | ${row.method || row.status}`);
  });
  doc.end();
}

module.exports = router;
