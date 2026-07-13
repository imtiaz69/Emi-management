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
const SALE_LOAN_STATUSES = ["approved", "active", "closed", "defaulted"];
const OPEN_SCHEDULE_STATUSES = ["pending", "partial", "overdue"];
const COLLECTION_TYPES = ["order_payment", "down_payment", "installment"];
const EMI_COLLECTION_TYPES = ["down_payment", "installment"];
const EXCLUDED_ORDER_STATUSES = ["cancelled", "returned"];
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
    const activeLoanCount = await Loan.countDocuments({ ...scope.loan, status: "active" });
    const dueSchedules = await EMISchedule.find({ ...scope.schedule, status: { $in: OPEN_SCHEDULE_STATUSES } });
    const emiDue = dueSchedules.reduce((sum, row) => sum + scheduleBalance(row), 0);
    const overdueSchedules = dueSchedules.filter((row) => row.dueDate < now);
    const overdueCount = overdueSchedules.length;
    const overdueAmount = overdueSchedules.reduce((sum, row) => sum + scheduleBalance(row), 0);
    const monthStart = dayjs().startOf("month").toDate();
    const collectionFilter = { ...scope.transaction, status: "confirmed", transactionType: { $in: COLLECTION_TYPES } };
    const collections = await Transaction.find({ ...collectionFilter, paymentDate: { $gte: monthStart } });
    const monthlyCollection = collections.reduce((sum, row) => sum + row.amount, 0);
    const allCollections = await Transaction.find(collectionFilter).select("amount transactionType");
    const totalCollection = allCollections.reduce((sum, row) => sum + row.amount, 0);
    const cashCollection = allCollections.filter((row) => row.transactionType === "order_payment").reduce((sum, row) => sum + row.amount, 0);
    const emiCollection = allCollections.filter((row) => EMI_COLLECTION_TYPES.includes(row.transactionType)).reduce((sum, row) => sum + row.amount, 0);
    const saleLoans = await Loan.find({ ...scope.loan, status: { $in: SALE_LOAN_STATUSES } }).select("principal");
    const emiSales = saleLoans.reduce((sum, row) => sum + row.principal, 0);
    const businessOrders = await Order.find(orderScopeFilter(req)).populate("items.productId", "name category price");
    const cashSales = businessOrders
      .filter((order) => order.paymentStatus === "paid")
      .reduce((sum, order) => sum + cashItemTotal(order, req), 0);
    const cashDue = businessOrders
      .filter((order) => ["unpaid", "partial"].includes(order.paymentStatus))
      .reduce((sum, order) => sum + cashItemTotal(order, req), 0);
    const paidOrderCount = businessOrders.filter((order) => order.paymentStatus === "paid").length;
    const unpaidOrderCount = businessOrders.filter((order) => ["unpaid", "partial"].includes(order.paymentStatus)).length;
    const totalSales = cashSales + emiSales;
    const totalDue = cashDue + emiDue;
    const requestedLoansCount = req.user.role === "seller" ? await Loan.countDocuments({ sellerId: req.user._id, status: "requested" }) : 0;
    const lowStockProducts = req.user.role === "seller" ? await Product.find({ sellerId: req.user._id, $expr: { $lte: ["$stock", "$lowStockThreshold"] }, status: "active" }) : [];
    res.json({
      activeEmis: activeLoanCount,
      activeLoanCount,
      dueAmount: roundMoney(emiDue),
      totalDue: roundMoney(totalDue),
      cashDue: roundMoney(cashDue),
      emiDue: roundMoney(emiDue),
      overdueCount,
      monthlyCollection: roundMoney(monthlyCollection),
      totalCollection: roundMoney(totalCollection),
      cashCollection: roundMoney(cashCollection),
      emiCollection: roundMoney(emiCollection),
      totalOverdueAmount: roundMoney(overdueAmount),
      overdueAmount: roundMoney(overdueAmount),
      totalSales: roundMoney(totalSales),
      cashSales: roundMoney(cashSales),
      emiSales: roundMoney(emiSales),
      paidOrderCount,
      unpaidOrderCount,
      requestedLoansCount,
      lowStockProducts
    });
  })
);

router.get(
  "/collections",
  validateQuery(dateFilterSchema),
  asyncHandler(async (req, res) => {
    const query = { ...scopeFilter(req).transaction, status: "confirmed", transactionType: { $in: COLLECTION_TYPES } };
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
    const rows = await buildSalesRows(req, req.validatedQuery || {});
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
    const query = orderBaseFilter(req);
    applyDateRange(query, req.validatedQuery, "createdAt");
    const rows = await Order.find(query).populate("buyerId", "name phone").sort({ createdAt: -1 }).limit(1000);
    res.json({
      rows,
      totals: {
        orderCount: rows.length,
        orderTotal: roundMoney(rows.reduce((sum, row) => sum + orderItemTotal(row, req), 0)),
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
    const query = { ...scopeFilter(req).transaction, transactionType: "down_payment", status: "confirmed" };
    applyDateRange(query, req.validatedQuery, "paymentDate");
    const rows = await Transaction.find(query).populate("buyerId", "name phone").populate("loanId").sort({ paymentDate: -1 }).limit(1000);
    res.json({ rows, totals: { amount: roundMoney(rows.reduce((sum, row) => sum + row.amount, 0)) } });
  })
);

router.get(
  "/payment-methods",
  asyncHandler(async (req, res) => {
    const rows = await Transaction.aggregate([
      { $match: { ...scopeFilter(req).transaction, status: "confirmed", transactionType: { $in: COLLECTION_TYPES } } },
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

function orderBaseFilter(req) {
  const query = {};
  if (req.user.role === "seller") query.sellerIds = req.user._id;
  if (req.user.role === "buyer") query.buyerId = req.user._id;
  return query;
}

function orderScopeFilter(req) {
  return {
    ...orderBaseFilter(req),
    paymentStatus: { $ne: "refunded" },
    fulfillmentStatus: { $nin: EXCLUDED_ORDER_STATUSES }
  };
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
  if (type === "sales") return buildSalesRows(req, req.validatedQuery || {});
  if (type === "orders") {
    const query = orderBaseFilter(req);
    return Order.find(query).populate("buyerId", "name phone").limit(1000);
  }
  if (type === "emi-portfolio") return Loan.find(scopeFilter(req).loan).populate("buyerId", "name phone").limit(1000);
  if (type === "down-payments") return Transaction.find({ ...scopeFilter(req).transaction, transactionType: "down_payment", status: "confirmed" }).populate("buyerId", "name phone").limit(1000);
  return Transaction.find({ ...scopeFilter(req).transaction, status: "confirmed", transactionType: { $in: COLLECTION_TYPES } }).populate("buyerId", "name phone").limit(1000);
}

async function buildSalesRows(req, params = {}) {
  const loanQuery = { ...scopeFilter(req).loan, status: { $in: SALE_LOAN_STATUSES } };
  applyDateRange(loanQuery, params, "createdAt");
  const loans = await Loan.find(loanQuery).populate("buyerId", "name phone").populate("productId", "name category price").sort({ createdAt: -1 }).limit(1000);
  const emiRows = loans.map((loan) => ({
    date: loan.createdAt,
    saleType: "EMI",
    buyer: loan.buyerId?.name || "",
    buyerId: loan.buyerId,
    product: loan.productId?.name || "Offline/custom loan",
    category: loan.productId?.category || "Custom",
    principal: loan.principal,
    downPayment: loan.downPayment,
    totalPayable: loan.totalPayable,
    status: loan.status
  }));

  const orderQuery = { ...orderScopeFilter(req), paymentStatus: "paid" };
  applyDateRange(orderQuery, params, "createdAt");
  const orders = await Order.find(orderQuery).populate("buyerId", "name phone").populate("items.productId", "name category price").sort({ createdAt: -1 }).limit(1000);
  const cashRows = orders.flatMap((order) =>
    scopedItems(order, req)
      .filter((item) => item.financeMode === "cash" && !EXCLUDED_ORDER_STATUSES.includes(item.fulfillmentStatus))
      .map((item) => ({
        date: order.createdAt,
        saleType: "Cash",
        buyer: order.buyerId?.name || "",
        buyerId: order.buyerId,
        orderNo: order.orderNo,
        product: item.name || item.productId?.name || "Product",
        category: item.productId?.category || "Product",
        principal: item.totalPrice,
        downPayment: 0,
        totalPayable: item.totalPrice,
        status: order.paymentStatus
      }))
  );

  return [...cashRows, ...emiRows].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 1000);
}

function scheduleBalance(row) {
  return Math.max(0, Number(row.amountDue || 0) + Number(row.lateFee || 0) - Number(row.amountPaid || 0));
}

function scopedItems(order, req) {
  const items = order.items || [];
  if (req.user.role !== "seller") return items;
  const sellerId = req.user._id.toString();
  return items.filter((item) => item.sellerId?.toString() === sellerId);
}

function orderItemTotal(order, req) {
  return scopedItems(order, req)
    .filter((item) => !EXCLUDED_ORDER_STATUSES.includes(item.fulfillmentStatus))
    .reduce((sum, item) => sum + Number(item.totalPrice || 0), 0);
}

function cashItemTotal(order, req) {
  return scopedItems(order, req)
    .filter((item) => item.financeMode === "cash" && !EXCLUDED_ORDER_STATUSES.includes(item.fulfillmentStatus))
    .reduce((sum, item) => sum + Number(item.totalPrice || 0), 0);
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
      date: dayjs(row.date || row.paymentDate || row.dueDate || row.createdAt).format("YYYY-MM-DD"),
      buyer: row.buyer || row.buyerId?.name || "",
      amount: row.amount || row.principal || row.totalPayable || row.amountDue,
      status: row.saleType ? `${row.saleType} ${row.status}` : row.method || row.status
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
    doc.fontSize(10).text(`${dayjs(row.date || row.paymentDate || row.dueDate || row.createdAt).format("YYYY-MM-DD")} | ${row.buyer || row.buyerId?.name || ""} | ${row.amount || row.principal || row.totalPayable || row.amountDue} | ${row.saleType ? `${row.saleType} ${row.status}` : row.method || row.status}`);
  });
  doc.end();
}

module.exports = router;
