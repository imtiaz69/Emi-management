const dayjs = require("dayjs");
const ExcelJS = require("exceljs");
const express = require("express");
const Loan = require("../models/Loan");
const Product = require("../models/Product");
const EMISchedule = require("../models/EMISchedule");
const Transaction = require("../models/Transaction");
const Order = require("../models/Order");
const SellerProfile = require("../models/SellerProfile");
const asyncHandler = require("../utils/asyncHandler");
const { authenticate } = require("../middleware/auth");
const { validateQuery, z } = require("../middleware/validate");
const { calculateRiskScore, riskCategoryFromDays, roundMoney } = require("../services/emiService");
const {
  createReportDocument,
  formatReportValue,
  getReportDefinition,
  getReportSummary
} = require("../services/reportDocumentService");
const {
  COLLECTION_TYPES,
  EMI_COLLECTION_TYPES,
  EXCLUDED_ORDER_STATUSES,
  OPEN_SCHEDULE_STATUSES,
  SALE_LOAN_STATUSES,
  calculateSellerAccounting,
  scheduleBalance,
  sellerOrderFinancials
} = require("../services/sellerAccountingService");

const router = express.Router();
router.use(authenticate);
const dateFilterSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional()
});
const reportQuerySchema = dateFilterSchema.extend({
  type: z.enum(["collections", "overdue", "sales", "orders", "emi-portfolio", "down-payments"]).optional().default("collections"),
});
const exportQuerySchema = reportQuerySchema.extend({
  format: z.enum(["excel", "pdf"]).optional().default("excel")
});
const summaryDetailSchema = z.object({
  metric: z.enum([
    "total_sales",
    "cash_sales",
    "emi_sales",
    "total_collection",
    "cash_collection",
    "emi_collection",
    "monthly_collection",
    "delivery_collection",
    "down_payments",
    "installments",
    "finance_charge",
    "late_fees",
    "total_due",
    "upcoming_due",
    "overdue",
    "active_loans",
    "paid_cash_orders",
    "unpaid_cash_orders",
    "pending_requests",
    "awaiting_down_payments",
    "ready_delivery",
    "low_stock"
  ])
});

router.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const scope = scopeFilter(req);
    const [loans, schedules, transactions, orders, lowStockProducts] = await Promise.all([
      Loan.find(scope.loan).select("sellerId buyerId productId orderId principal downPayment totalPayable status source createdAt"),
      EMISchedule.find(scope.schedule).select("loanId amountDue amountPaid lateFee dueDate status"),
      Transaction.find({
        ...scope.transaction,
        status: "confirmed",
        transactionType: { $in: COLLECTION_TYPES }
      }).select("loanId orderId amount transactionType status paymentDate"),
      Order.find(orderBaseFilter(req)).select("items paymentStatus fulfillmentStatus discount deliveryCharge createdAt"),
      req.user.role === "seller"
        ? Product.find({ sellerId: req.user._id, $expr: { $lte: ["$stock", "$lowStockThreshold"] }, status: "active" })
        : []
    ]);
    const accounting = calculateSellerAccounting({
      loans,
      schedules,
      transactions,
      orders,
      sellerId: req.user.role === "seller" ? req.user._id : undefined
    });
    if (req.user.role === "buyer") {
      const monthStart = dayjs().startOf("month").toDate();
      accounting.monthlyCollection = roundMoney(
        transactions
          .filter((row) => EMI_COLLECTION_TYPES.includes(row.transactionType) && row.paymentDate >= monthStart)
          .reduce((sum, row) => sum + Number(row.amount || 0), 0)
      );
    }
    const requestedLoansCount = req.user.role === "seller" ? loans.filter((loan) => loan.status === "requested").length : 0;
    const awaitingDownPaymentCount = req.user.role === "seller" ? loans.filter((loan) => loan.status === "approved").length : 0;
    res.json({
      ...accounting,
      requestedLoansCount,
      awaitingDownPaymentCount,
      lowStockProducts
    });
  })
);

router.get(
  "/summary/details",
  validateQuery(summaryDetailSchema),
  asyncHandler(async (req, res) => {
    const metric = req.validatedQuery.metric;
    const rows = await buildSummaryDetailRows(req, metric);
    res.json({
      metric,
      count: rows.length,
      total: roundMoney(rows.reduce((sum, row) => sum + Number(row.amount || 0), 0)),
      rows: rows.slice(0, 500)
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
  validateQuery(dateFilterSchema),
  asyncHandler(async (req, res) => {
    const query = { ...scopeFilter(req).schedule, status: { $in: ["pending", "partial", "overdue"] }, dueDate: { $lt: new Date() } };
    applyDateRange(query, req.validatedQuery, "dueDate");
    const rows = await EMISchedule.find(query)
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
  "/preview",
  validateQuery(reportQuerySchema),
  asyncHandler(async (req, res) => {
    const type = req.validatedQuery.type || "collections";
    const rows = await getReportRows(req, type, req.validatedQuery || {});
    const definition = getReportDefinition(type);
    res.json({
      type,
      title: definition.title,
      description: definition.description,
      basis: definition.basis,
      columns: definition.columns.map(({ key, label, format, align }) => ({ key, label, format, align })),
      summaries: getReportSummary(type, rows),
      count: rows.length,
      rows: rows.slice(0, 500),
      generatedAt: new Date()
    });
  })
);

router.get(
  "/export",
  validateQuery(exportQuerySchema),
  asyncHandler(async (req, res) => {
    const type = req.validatedQuery.type || "collections";
    const format = req.validatedQuery.format || "excel";
    const filters = req.validatedQuery || {};
    const rows = await getReportRows(req, type, filters);
    const organization = await getReportOrganization(req);
    const context = {
      organization,
      filters,
      generatedBy: { name: req.user.name, email: req.user.email, role: req.user.role },
      generatedAt: new Date()
    };

    if (format === "pdf") return exportPdf(res, type, rows, context);
    return exportExcel(res, type, rows, context);
  })
);

router.get(
  "/sales",
  validateQuery(dateFilterSchema),
  asyncHandler(async (req, res) => {
    const rows = await buildSalesRows(req, req.validatedQuery || {});
    res.json({ rows, totals: sumRows(rows, ["principal", "downPayment", "totalPayable", "contractValue"]) });
  })
);

router.get(
  "/emi-portfolio",
  validateQuery(dateFilterSchema),
  asyncHandler(async (req, res) => {
    const rows = await buildPortfolioRows(req, req.validatedQuery || {});
    res.json({ rows, totals: sumRows(rows, ["principal", "totalPayable", "outstanding"]) });
  })
);

router.get(
  "/orders",
  validateQuery(dateFilterSchema),
  asyncHandler(async (req, res) => {
    const rows = await buildOrderRows(req, req.validatedQuery || {});
    res.json({
      rows,
      totals: {
        orderCount: rows.length,
        orderTotal: roundMoney(rows.reduce((sum, row) => sum + Number(row.amount || 0), 0)),
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
    const rows = await buildCollectionRows(req, req.validatedQuery || {}, ["down_payment"]);
    res.json({ rows, totals: { amount: roundMoney(rows.reduce((sum, row) => sum + row.amount, 0)) } });
  })
);

router.get(
  "/payment-methods",
  validateQuery(dateFilterSchema),
  asyncHandler(async (req, res) => {
    const match = { ...scopeFilter(req).transaction, status: "confirmed", transactionType: { $in: COLLECTION_TYPES } };
    applyDateRange(match, req.validatedQuery, "paymentDate");
    const rows = await Transaction.aggregate([
      { $match: match },
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
  if (params.from && params.to && dayjs(params.from).isAfter(dayjs(params.to))) {
    const error = new Error("The report start date cannot be after the end date");
    error.status = 400;
    throw error;
  }
  if (params.from || params.to) {
    query[field] = {
      ...(query[field] || {}),
      ...(params.from && { $gte: dayjs(params.from).startOf("day").toDate() }),
      ...(params.to && { $lte: dayjs(params.to).endOf("day").toDate() })
    };
  }
}

async function getReportRows(req, type, params = {}) {
  if (type === "overdue") return buildOverdueRows(req, params);
  if (type === "sales") return buildSalesRows(req, params);
  if (type === "orders") return buildOrderRows(req, params);
  if (type === "emi-portfolio") return buildPortfolioRows(req, params);
  if (type === "down-payments") return buildCollectionRows(req, params, ["down_payment"]);
  return buildCollectionRows(req, params, COLLECTION_TYPES);
}

async function buildCollectionRows(req, params = {}, transactionTypes = COLLECTION_TYPES) {
  const query = {
    ...scopeFilter(req).transaction,
    status: "confirmed",
    transactionType: { $in: transactionTypes }
  };
  applyDateRange(query, params, "paymentDate");
  const transactions = await Transaction.find(query)
    .populate("buyerId", "name phone")
    .populate("loanId", "_id status")
    .populate("orderId", "orderNo")
    .sort({ paymentDate: -1 })
    .limit(1000);

  return transactions.map((transaction) => ({
    id: transaction._id,
    date: transaction.paymentDate,
    reference: transaction.receiptNo || transaction.gatewayRef || shortReference(transaction._id, "TX"),
    loanReference: transaction.loanId?._id ? shortReference(transaction.loanId._id, "LN") : "-",
    buyer: transaction.buyerId?.name || "",
    buyerPhone: transaction.buyerId?.phone || "",
    transactionType: reportTransactionType(transaction.transactionType),
    method: titleCase(transaction.method),
    amount: roundMoney(transaction.amount),
    status: transaction.status,
    orderNo: transaction.orderId?.orderNo || "",
    gatewayRef: transaction.gatewayRef || ""
  }));
}

async function buildOverdueRows(req, params = {}) {
  const query = {
    ...scopeFilter(req).schedule,
    status: { $in: ["pending", "partial", "overdue"] },
    dueDate: { $lt: new Date() }
  };
  applyDateRange(query, params, "dueDate");
  const schedules = await EMISchedule.find(query)
    .populate("buyerId", "name phone")
    .populate({ path: "loanId", populate: { path: "productId", select: "name" } })
    .sort({ dueDate: 1 })
    .limit(1000);
  const loanIds = [...new Set(schedules.map((row) => row.loanId?._id?.toString()).filter(Boolean))];
  const allLoanSchedules = loanIds.length
    ? await EMISchedule.find({ loanId: { $in: loanIds } }).select("loanId amountDue")
    : [];
  const scheduleStats = new Map();
  allLoanSchedules.forEach((schedule) => {
    const key = schedule.loanId.toString();
    const current = scheduleStats.get(key) || { count: 0, total: 0 };
    current.count += 1;
    current.total += Number(schedule.amountDue || 0);
    scheduleStats.set(key, current);
  });

  return schedules.map((schedule) => {
    const loanId = schedule.loanId?._id?.toString();
    const stats = scheduleStats.get(loanId) || { count: 0, total: 0 };
    const daysOverdue = Math.max(1, dayjs().diff(dayjs(schedule.dueDate), "day"));
    const balance = scheduleBalance(schedule);
    return {
      id: schedule._id,
      date: schedule.dueDate,
      reference: `${shortReference(loanId, "LN")} / #${schedule.installmentNo}`,
      buyer: schedule.buyerId?.name || "",
      buyerPhone: schedule.buyerId?.phone || "",
      product: schedule.loanId?.productId?.name || "Offline/custom loan",
      installmentNo: schedule.installmentNo,
      daysOverdue,
      lateFee: roundMoney(schedule.lateFee),
      balance: roundMoney(balance),
      riskCategory: riskCategoryFromDays(daysOverdue),
      riskScore: calculateRiskScore({
        overdueAmount: balance,
        totalDaysOverdue: daysOverdue,
        totalEmis: stats.count,
        averageEmi: stats.count ? stats.total / stats.count : 0
      }),
      status: schedule.status
    };
  });
}

async function buildOrderRows(req, params = {}) {
  const query = orderBaseFilter(req);
  applyDateRange(query, params, "createdAt");
  const orders = await Order.find(query)
    .populate("buyerId", "name phone")
    .sort({ createdAt: -1 })
    .limit(1000);

  return orders.map((order) => {
    const allSellerItems = scopedItems(order, req);
    const sellerItems = allSellerItems.filter((item) => !EXCLUDED_ORDER_STATUSES.includes(item.fulfillmentStatus));
    const financeModes = [...new Set(allSellerItems.map((item) => item.financeMode).filter(Boolean))];
    return {
      id: order._id,
      date: order.createdAt,
      reference: order.orderNo,
      buyer: order.buyerId?.name || "",
      buyerPhone: order.buyerId?.phone || "",
      product: allSellerItems.map((item) => `${item.name} x${item.quantity}`).join(", ") || "No seller items",
      itemCount: sellerItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
      paymentMode: titleCase(financeModes.length > 1 ? "mixed" : financeModes[0] || order.paymentMode),
      amount: roundMoney(orderItemTotal(order, req)),
      paymentStatus: order.paymentStatus,
      fulfillmentStatus: sellerFulfillmentStatus(allSellerItems, order.fulfillmentStatus)
    };
  });
}

async function buildPortfolioRows(req, params = {}) {
  const query = scopeFilter(req).loan;
  applyDateRange(query, params, "createdAt");
  const loans = await Loan.find(query)
    .populate("buyerId", "name phone")
    .populate("productId", "name category")
    .sort({ createdAt: -1 })
    .limit(1000);
  const schedules = loans.length
    ? await EMISchedule.find({ loanId: { $in: loans.map((loan) => loan._id) } }).select("loanId amountDue amountPaid lateFee status")
    : [];
  const outstandingByLoan = new Map();
  schedules
    .filter((schedule) => OPEN_SCHEDULE_STATUSES.includes(schedule.status))
    .forEach((schedule) => {
      const key = schedule.loanId.toString();
      outstandingByLoan.set(key, (outstandingByLoan.get(key) || 0) + scheduleBalance(schedule));
    });

  return loans.map((loan) => ({
    id: loan._id,
    loanId: loan._id,
    date: loan.activatedAt || loan.createdAt,
    reference: shortReference(loan._id, "LN"),
    buyer: loan.buyerId?.name || "",
    buyerPhone: loan.buyerId?.phone || "",
    product: loan.productId?.name || "Offline/custom loan",
    category: loan.productId?.category || "Custom",
    tenureMonths: loan.tenureMonths,
    principal: roundMoney(loan.principal),
    totalPayable: roundMoney(loan.totalPayable),
    outstanding: roundMoney(outstandingByLoan.get(loan._id.toString()) || 0),
    status: loan.status
  }));
}

async function buildSalesRows(req, params = {}) {
  const loanQuery = { ...scopeFilter(req).loan, status: { $in: SALE_LOAN_STATUSES } };
  applyDateRange(loanQuery, params, "createdAt");
  const loans = await Loan.find(loanQuery).populate("buyerId", "name phone").populate("productId", "name category price").sort({ createdAt: -1 }).limit(1000);
  const emiRows = loans.map((loan) => ({
    id: loan._id,
    date: loan.createdAt,
    saleType: "EMI",
    buyer: loan.buyerId?.name || "",
    buyerId: loan.buyerId,
    product: loan.productId?.name || "Offline/custom loan",
    category: loan.productId?.category || "Custom",
    principal: loan.principal,
    downPayment: loan.downPayment,
    totalPayable: loan.totalPayable,
    contractValue: roundMoney(Number(loan.downPayment || 0) + Number(loan.totalPayable || 0)),
    status: loan.status,
    reference: shortReference(loan._id, "LN"),
    href: `/loans/${loan._id}`
  }));

  const orderQuery = { ...orderScopeFilter(req), paymentStatus: "paid" };
  applyDateRange(orderQuery, params, "createdAt");
  const orders = await Order.find(orderQuery).populate("buyerId", "name phone").populate("items.productId", "name category price").sort({ createdAt: -1 }).limit(1000);
  const cashRows = orders.flatMap((order) =>
    scopedItems(order, req)
      .filter((item) => item.financeMode === "cash" && !EXCLUDED_ORDER_STATUSES.includes(item.fulfillmentStatus))
      .map((item) => ({
        id: `${order._id}-${item._id}`,
        date: order.createdAt,
        saleType: "Cash",
        buyer: order.buyerId?.name || "",
        buyerId: order.buyerId,
        orderNo: order.orderNo,
        product: item.name || item.productId?.name || "Product",
        category: item.productId?.category || "Product",
        principal: cashItemNetTotal(order, item),
        downPayment: 0,
        totalPayable: cashItemNetTotal(order, item),
        contractValue: cashItemNetTotal(order, item),
        status: order.paymentStatus,
        reference: order.orderNo,
        href: `/orders/${order._id}`
      }))
  );

  return [...cashRows, ...emiRows].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 1000);
}

async function getReportOrganization(req) {
  if (req.user.role === "seller") {
    const profile = await SellerProfile.findOne({ userId: req.user._id }).lean();
    return {
      name: profile?.shopName || req.user.name,
      owner: profile?.ownerName || req.user.name,
      email: req.user.email,
      phone: req.user.phone,
      address: profile?.address || ""
    };
  }
  return {
    name: req.user.role === "admin" ? "FinanceLend Administration" : req.user.name,
    owner: req.user.name,
    email: req.user.email,
    phone: req.user.phone,
    address: ""
  };
}

function reportTransactionType(type) {
  if (type === "order_payment") return "Cash order";
  if (type === "down_payment") return "Down payment";
  if (type === "installment") return "EMI installment";
  return titleCase(type);
}

function shortReference(value, prefix) {
  const id = String(value?._id || value || "");
  return id ? `${prefix}-${id.slice(-8).toUpperCase()}` : "-";
}

function titleCase(value) {
  return String(value || "-")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function sellerFulfillmentStatus(items, fallback) {
  if (!items.length) return fallback;
  const statuses = items.map((item) => item.fulfillmentStatus);
  if (statuses.every((status) => status === "cancelled")) return "cancelled";
  if (statuses.every((status) => status === "returned")) return "returned";
  const activeStatuses = statuses.filter((status) => !EXCLUDED_ORDER_STATUSES.includes(status));
  if (!activeStatuses.length) return statuses[0] || fallback;
  const progress = ["pending", "confirmed", "processing", "shipped", "delivered"];
  return activeStatuses.reduce((earliest, status) => (
    progress.indexOf(status) < progress.indexOf(earliest) ? status : earliest
  ), activeStatuses[0]);
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

function cashItemNetTotal(order, item) {
  const eligibleSubtotal = (order.items || [])
    .filter((row) => !EXCLUDED_ORDER_STATUSES.includes(row.fulfillmentStatus))
    .reduce((sum, row) => sum + Number(row.totalPrice || 0), 0);
  if (!eligibleSubtotal) return 0;
  const discountShare = Number(order.discount || 0) * (Number(item.totalPrice || 0) / eligibleSubtotal);
  return roundMoney(Math.max(Number(item.totalPrice || 0) - discountShare, 0));
}

async function buildSummaryDetailRows(req, metric) {
  if (["total_collection", "cash_collection", "emi_collection", "monthly_collection", "down_payments", "installments"].includes(metric)) {
    const typeByMetric = {
      cash_collection: ["order_payment"],
      emi_collection: EMI_COLLECTION_TYPES,
      down_payments: ["down_payment"],
      installments: ["installment"]
    };
    const query = {
      ...scopeFilter(req).transaction,
      status: "confirmed",
      transactionType: { $in: typeByMetric[metric] || COLLECTION_TYPES }
    };
    if (metric === "monthly_collection") query.paymentDate = { $gte: dayjs().startOf("month").toDate() };
    const transactions = await Transaction.find(query)
      .populate("buyerId", "name phone")
      .populate("loanId", "productId status")
      .populate("orderId", "orderNo")
      .sort({ paymentDate: -1 })
      .limit(500);
    return transactions.map((transaction) => ({
      id: transaction._id,
      date: transaction.paymentDate,
      type: formatTransactionType(transaction.transactionType),
      reference: transaction.receiptNo || transaction.orderId?.orderNo || transaction.loanId?._id?.toString(),
      buyer: transaction.buyerId?.name || "",
      description: `${transaction.method}${transaction.notes ? ` | ${transaction.notes}` : ""}`,
      amount: transaction.amount,
      status: transaction.status,
      href: transaction.orderId?._id ? `/orders/${transaction.orderId._id}` : transaction.loanId?._id ? `/loans/${transaction.loanId._id}` : ""
    }));
  }

  if (metric === "delivery_collection") {
    const transactions = await Transaction.find({
      ...scopeFilter(req).transaction,
      status: "confirmed",
      transactionType: "order_payment",
      orderId: { $exists: true, $ne: null }
    })
      .populate("buyerId", "name phone")
      .populate("orderId")
      .sort({ paymentDate: -1 })
      .limit(500);
    return transactions
      .filter((transaction) => transaction.orderId)
      .map((transaction) => {
        const delivery = sellerOrderFinancials(
          transaction.orderId,
          req.user.role === "seller" ? req.user._id : undefined
        ).delivery;
        return {
          id: transaction._id,
          date: transaction.paymentDate,
          type: "Delivery receipt",
          reference: transaction.orderId.orderNo,
          buyer: transaction.buyerId?.name || "",
          description: "Delivery charge included in confirmed cash receipt",
          amount: delivery,
          status: transaction.status,
          href: `/orders/${transaction.orderId._id}`
        };
      })
      .filter((row) => row.amount > 0);
  }

  if (["total_due", "upcoming_due", "overdue"].includes(metric)) {
    const now = new Date();
    const query = { ...scopeFilter(req).schedule, status: { $in: OPEN_SCHEDULE_STATUSES } };
    if (metric === "upcoming_due") query.dueDate = { $gte: now };
    if (metric === "overdue") query.dueDate = { $lt: now };
    const schedules = await EMISchedule.find(query)
      .populate("buyerId", "name phone")
      .populate({ path: "loanId", populate: { path: "productId", select: "name" } })
      .sort({ dueDate: 1 })
      .limit(500);
    return schedules.map((schedule) => ({
      id: schedule._id,
      date: schedule.dueDate,
      type: metric === "overdue" ? "Overdue EMI" : "EMI installment",
      reference: `${schedule.loanId?._id || ""} / #${schedule.installmentNo}`,
      buyer: schedule.buyerId?.name || "",
      description: schedule.loanId?.productId?.name || "Offline/custom loan",
      amount: scheduleBalance(schedule),
      status: schedule.dueDate < now ? "overdue" : schedule.status,
      href: schedule.loanId?._id ? `/loans/${schedule.loanId._id}` : ""
    }));
  }

  if (["total_sales", "cash_sales", "emi_sales"].includes(metric)) {
    const rows = await buildSalesRows(req);
    return rows
      .filter((row) => metric === "total_sales" || (metric === "cash_sales" ? row.saleType === "Cash" : row.saleType === "EMI"))
      .map((row) => ({
        id: row.id,
        date: row.date,
        type: `${row.saleType} product sale`,
        reference: row.reference,
        buyer: row.buyer,
        description: row.product,
        amount: row.principal,
        status: row.status,
        href: row.href
      }));
  }

  if (["active_loans", "pending_requests", "awaiting_down_payments"].includes(metric)) {
    const statusByMetric = {
      active_loans: "active",
      pending_requests: "requested",
      awaiting_down_payments: "approved"
    };
    const loans = await Loan.find({ ...scopeFilter(req).loan, status: statusByMetric[metric] })
      .populate("buyerId", "name phone")
      .populate("productId", "name")
      .sort({ createdAt: -1 })
      .limit(500);
    return loans.map((loan) => ({
      id: loan._id,
      date: loan.activatedAt || loan.approvedAt || loan.createdAt,
      type: metric === "active_loans" ? "Active EMI" : metric === "pending_requests" ? "EMI request" : "Awaiting down payment",
      reference: loan._id.toString(),
      buyer: loan.buyerId?.name || "",
      description: loan.productId?.name || "Offline/custom loan",
      amount: loan.principal,
      status: loan.status,
      href: `/loans/${loan._id}`
    }));
  }

  if (metric === "finance_charge") {
    const loans = await Loan.find({ ...scopeFilter(req).loan, status: { $in: SALE_LOAN_STATUSES } })
      .populate("buyerId", "name phone")
      .populate("productId", "name")
      .sort({ createdAt: -1 })
      .limit(500);
    return loans
      .map((loan) => ({
        id: loan._id,
        date: loan.activatedAt || loan.createdAt,
        type: "EMI finance charge",
        reference: loan._id.toString(),
        buyer: loan.buyerId?.name || "",
        description: loan.productId?.name || "Offline/custom loan",
        amount: roundMoney(Math.max(Number(loan.downPayment || 0) + Number(loan.totalPayable || 0) - Number(loan.principal || 0), 0)),
        status: loan.status,
        href: `/loans/${loan._id}`
      }))
      .filter((row) => row.amount > 0);
  }

  if (metric === "late_fees") {
    const schedules = await EMISchedule.find({
      ...scopeFilter(req).schedule,
      lateFee: { $gt: 0 }
    })
      .populate("buyerId", "name phone")
      .populate({ path: "loanId", populate: { path: "productId", select: "name" } })
      .sort({ dueDate: 1 })
      .limit(500);
    return schedules
      .map((schedule) => ({
        id: schedule._id,
        date: schedule.dueDate,
        type: "Outstanding late fee",
        reference: `${schedule.loanId?._id || ""} / #${schedule.installmentNo}`,
        buyer: schedule.buyerId?.name || "",
        description: schedule.loanId?.productId?.name || "Offline/custom loan",
        amount: roundMoney(Number(schedule.lateFee || 0)),
        status: schedule.status,
        href: schedule.loanId?._id ? `/loans/${schedule.loanId._id}` : ""
      }))
      .filter((row) => row.amount > 0);
  }

  if (["paid_cash_orders", "unpaid_cash_orders", "ready_delivery"].includes(metric)) {
    const orders = await Order.find(orderBaseFilter(req))
      .populate("buyerId", "name phone")
      .populate("items.loanId")
      .sort({ createdAt: -1 })
      .limit(500);
    return orders
      .map((order) => ({
        order,
        financials: sellerOrderFinancials(order, req.user.role === "seller" ? req.user._id : undefined)
      }))
      .filter(({ order, financials }) => {
        if (metric === "paid_cash_orders") return financials.hasCashItems && order.paymentStatus === "paid";
        if (metric === "unpaid_cash_orders") return financials.hasCashItems && order.paymentStatus === "unpaid";
        return scopedItems(order, req).some((item) => ["confirmed", "processing"].includes(item.fulfillmentStatus));
      })
      .map(({ order, financials }) => ({
        id: order._id,
        date: order.createdAt,
        type: metric === "ready_delivery" ? "Ready for delivery" : "Cash order",
        reference: order.orderNo,
        buyer: order.buyerId?.name || "",
        description: scopedItems(order, req).map((item) => item.name).join(", "),
        amount:
          metric === "unpaid_cash_orders"
            ? financials.checkoutValue
            : metric === "paid_cash_orders"
              ? financials.netProductValue
              : orderItemTotal(order, req),
        status: metric === "ready_delivery" ? order.fulfillmentStatus : order.paymentStatus,
        href: `/orders/${order._id}`
      }));
  }

  if (metric === "low_stock") {
    const products = await Product.find({
      ...(req.user.role === "seller" ? { sellerId: req.user._id } : {}),
      $expr: { $lte: ["$stock", "$lowStockThreshold"] },
      status: "active"
    })
      .sort({ stock: 1 })
      .limit(500);
    return products.map((product) => ({
      id: product._id,
      date: product.updatedAt,
      type: "Low stock",
      reference: product.sku || product._id.toString(),
      buyer: "",
      description: `${product.name} | ${product.stock} remaining`,
      amount: product.price,
      status: "low",
      href: `/products/${product._id}`
    }));
  }

  return [];
}

function formatTransactionType(type) {
  if (type === "order_payment") return "Cash order receipt";
  if (type === "down_payment") return "EMI down payment";
  if (type === "installment") return "EMI installment";
  return type;
}

function sumRows(rows, fields) {
  return fields.reduce((totals, field) => ({ ...totals, [field]: roundMoney(rows.reduce((sum, row) => sum + Number(row[field] || 0), 0)) }), {});
}

async function exportExcel(res, type, rows, context) {
  const definition = getReportDefinition(type);
  const summaries = getReportSummary(type, rows);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "FinanceLend EMI Management";
  workbook.created = context.generatedAt;
  workbook.modified = context.generatedAt;
  workbook.subject = definition.description;
  workbook.title = `${definition.title} - ${context.organization.name}`;

  const sheet = workbook.addWorksheet(definition.shortTitle.slice(0, 31), {
    views: [{ state: "frozen", ySplit: 8, showGridLines: false }]
  });
  const columnCount = definition.columns.length;
  const lastColumn = sheet.getColumn(columnCount).letter;
  sheet.mergeCells(`A1:${lastColumn}1`);
  sheet.getCell("A1").value = definition.title;
  sheet.getCell("A1").font = { bold: true, size: 18, color: { argb: "FFFFFFFF" } };
  sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF173A34" } };
  sheet.getCell("A1").alignment = { vertical: "middle" };
  sheet.getRow(1).height = 34;

  sheet.mergeCells(`A2:${lastColumn}2`);
  sheet.getCell("A2").value = `${context.organization.name || "FinanceLend"} | ${reportPeriodLabel(context.filters)} | Generated ${dayjs(context.generatedAt).format("DD MMM YYYY, hh:mm A")}`;
  sheet.getCell("A2").font = { size: 10, color: { argb: "FF607A75" } };
  sheet.getRow(2).height = 22;

  sheet.mergeCells(`A3:${lastColumn}3`);
  sheet.getCell("A3").value = definition.basis;
  sheet.getCell("A3").font = { italic: true, size: 9, color: { argb: "FF607A75" } };

  summaries.slice(0, Math.min(4, columnCount)).forEach((summary, index) => {
    const cell = sheet.getCell(5, index + 1);
    cell.value = summary.label;
    cell.font = { bold: true, size: 9, color: { argb: "FF607A75" } };
    const valueCell = sheet.getCell(6, index + 1);
    valueCell.value = Number(summary.value || 0);
    valueCell.font = { bold: true, size: 13, color: { argb: index === 0 ? "FF218671" : "FF173A34" } };
    if (summary.money) valueCell.numFmt = '"BDT" #,##0.00';
  });

  definition.columns.forEach((column, index) => {
    const excelColumn = sheet.getColumn(index + 1);
    excelColumn.width = Math.max(12, Math.round(column.width / 5.5));
    const cell = sheet.getCell(8, index + 1);
    cell.value = column.label;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 9 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF254E47" } };
    cell.alignment = { vertical: "middle", horizontal: column.align || "left" };
  });
  sheet.getRow(8).height = 24;

  rows.forEach((row, rowIndex) => {
    const excelRow = sheet.getRow(9 + rowIndex);
    definition.columns.forEach((column, columnIndex) => {
      const cell = excelRow.getCell(columnIndex + 1);
      if (column.format === "money") {
        cell.value = Number(row[column.key] || 0);
        cell.numFmt = '"BDT" #,##0.00';
      } else if (column.format === "date" && row[column.key]) {
        cell.value = new Date(row[column.key]);
        cell.numFmt = "dd mmm yyyy";
      } else {
        cell.value = formatReportValue(row[column.key], column.format);
      }
      cell.alignment = { vertical: "middle", horizontal: column.align || "left" };
      cell.border = { bottom: { style: "hair", color: { argb: "FFD8E4E1" } } };
      if (rowIndex % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F8F7" } };
    });
    excelRow.height = 21;
  });

  if (rows.length) sheet.autoFilter = { from: "A8", to: `${lastColumn}${8 + rows.length}` };
  sheet.pageSetup = {
    orientation: "landscape",
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 }
  };
  sheet.headerFooter.oddFooter = `FinanceLend | ${definition.shortTitle} | Page &P of &N`;

  const filename = reportFilename(type, context.filters, "xlsx");
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Cache-Control", "private, no-store");
  await workbook.xlsx.write(res);
  res.end();
}

function exportPdf(res, type, rows, context) {
  const doc = createReportDocument({ type, rows, ...context });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${reportFilename(type, context.filters, "pdf")}"`);
  res.setHeader("Cache-Control", "private, no-store");
  doc.pipe(res);
  doc.end();
}

function reportFilename(type, filters, extension) {
  const period = filters.from || filters.to ? `${filters.from || "start"}-to-${filters.to || "today"}` : "all-time";
  return `financelend-${type}-${period}.${extension}`;
}

function reportPeriodLabel(filters) {
  if (filters.from && filters.to) return `${dayjs(filters.from).format("DD MMM YYYY")} to ${dayjs(filters.to).format("DD MMM YYYY")}`;
  if (filters.from) return `From ${dayjs(filters.from).format("DD MMM YYYY")}`;
  if (filters.to) return `Through ${dayjs(filters.to).format("DD MMM YYYY")}`;
  return "All available records";
}

module.exports = router;
