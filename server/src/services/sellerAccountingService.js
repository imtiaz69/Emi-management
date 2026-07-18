const { roundMoney } = require("./emiService");

const SALE_LOAN_STATUSES = ["active", "closed", "defaulted"];
const OPEN_SCHEDULE_STATUSES = ["pending", "partial", "overdue"];
const COLLECTION_TYPES = ["order_payment", "down_payment", "installment"];
const EMI_COLLECTION_TYPES = ["down_payment", "installment"];
const EXCLUDED_ORDER_STATUSES = ["cancelled", "returned"];

function idOf(value) {
  return (value?._id || value)?.toString();
}

function scheduleBalance(row) {
  return Math.max(0, Number(row.amountDue || 0) + Number(row.lateFee || 0) - Number(row.amountPaid || 0));
}

function sellerOrderFinancials(order, sellerId) {
  const eligibleItems = (order.items || []).filter((item) => !EXCLUDED_ORDER_STATUSES.includes(item.fulfillmentStatus));
  const eligibleSubtotal = eligibleItems.reduce((sum, item) => sum + Number(item.totalPrice || 0), 0);
  const sellerCashItems = eligibleItems.filter(
    (item) => item.financeMode === "cash" && (!sellerId || idOf(item.sellerId) === idOf(sellerId))
  );
  const grossProductValue = sellerCashItems.reduce((sum, item) => sum + Number(item.totalPrice || 0), 0);
  const share = eligibleSubtotal > 0 ? grossProductValue / eligibleSubtotal : 0;
  const discount = Number(order.discount || 0) * share;
  const delivery = Number(order.deliveryCharge || 0) * share;
  const netProductValue = Math.max(grossProductValue - discount, 0);

  return {
    hasCashItems: sellerCashItems.length > 0,
    grossProductValue: roundMoney(grossProductValue),
    discount: roundMoney(discount),
    delivery: roundMoney(delivery),
    netProductValue: roundMoney(netProductValue),
    checkoutValue: roundMoney(netProductValue + delivery)
  };
}

function calculateSellerAccounting({ loans = [], schedules = [], transactions = [], orders = [], sellerId, now = new Date() }) {
  const saleLoans = loans.filter((loan) => SALE_LOAN_STATUSES.includes(loan.status));
  const activeLoans = loans.filter((loan) => loan.status === "active");
  const openSchedules = schedules.filter((row) => OPEN_SCHEDULE_STATUSES.includes(row.status));
  const overdueSchedules = openSchedules.filter((row) => new Date(row.dueDate) < now);
  const confirmedCollections = transactions.filter(
    (row) => row.status === "confirmed" && COLLECTION_TYPES.includes(row.transactionType)
  );
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthlyCollections = confirmedCollections.filter((row) => new Date(row.paymentDate) >= monthStart);
  const validOrders = orders.filter(
    (order) => order.paymentStatus !== "refunded" && !EXCLUDED_ORDER_STATUSES.includes(order.fulfillmentStatus)
  );
  const orderFinancials = validOrders.map((order) => ({ order, financials: sellerOrderFinancials(order, sellerId) }));
  const paidCashOrders = orderFinancials.filter(
    ({ order, financials }) => financials.hasCashItems && order.paymentStatus === "paid"
  );
  const unpaidCashOrders = orderFinancials.filter(
    ({ order, financials }) => financials.hasCashItems && order.paymentStatus === "unpaid"
  );

  const cashSales = paidCashOrders.reduce((sum, row) => sum + row.financials.netProductValue, 0);
  const emiSales = saleLoans.reduce((sum, loan) => sum + Number(loan.principal || 0), 0);
  const cashCollectionRows = confirmedCollections.filter((row) => row.transactionType === "order_payment");
  const collectedCashOrderIds = new Set(cashCollectionRows.map((row) => idOf(row.orderId)).filter(Boolean));
  const deliveryCollection = paidCashOrders
    .filter(({ order }) => collectedCashOrderIds.has(idOf(order)))
    .reduce((sum, row) => sum + row.financials.delivery, 0);
  const cashCollection = cashCollectionRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const downPaymentCollection = confirmedCollections
    .filter((row) => row.transactionType === "down_payment")
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const installmentCollection = confirmedCollections
    .filter((row) => row.transactionType === "installment")
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const emiCollection = downPaymentCollection + installmentCollection;
  const emiOutstanding = openSchedules.reduce((sum, row) => sum + scheduleBalance(row), 0);
  const overdueAmount = overdueSchedules.reduce((sum, row) => sum + scheduleBalance(row), 0);
  const upcomingDue = Math.max(emiOutstanding - overdueAmount, 0);
  const outstandingLateFees = openSchedules.reduce(
    (sum, row) => sum + Math.min(Number(row.lateFee || 0), scheduleBalance(row)),
    0
  );
  const lateFeesAssessed = schedules.reduce((sum, row) => sum + Number(row.lateFee || 0), 0);
  const unpaidCashOrderValue = unpaidCashOrders.reduce((sum, row) => sum + row.financials.checkoutValue, 0);
  const emiContractValue = saleLoans.reduce(
    (sum, loan) => sum + Number(loan.downPayment || 0) + Number(loan.totalPayable || 0),
    0
  );
  const emiFinanceCharge = saleLoans.reduce(
    (sum, loan) => sum + Math.max(Number(loan.downPayment || 0) + Number(loan.totalPayable || 0) - Number(loan.principal || 0), 0),
    0
  );
  const totalSales = cashSales + emiSales;
  const totalCollection = cashCollection + emiCollection;
  const expectedPosition = totalSales + emiFinanceCharge + deliveryCollection + lateFeesAssessed;
  const actualPosition = totalCollection + emiOutstanding;

  return {
    totalSales: roundMoney(totalSales),
    cashSales: roundMoney(cashSales),
    emiSales: roundMoney(emiSales),
    totalCollection: roundMoney(totalCollection),
    cashCollection: roundMoney(cashCollection),
    cashProductCollection: roundMoney(Math.max(cashCollection - deliveryCollection, 0)),
    deliveryCollection: roundMoney(deliveryCollection),
    emiCollection: roundMoney(emiCollection),
    downPaymentCollection: roundMoney(downPaymentCollection),
    installmentCollection: roundMoney(installmentCollection),
    monthlyCollection: roundMoney(monthlyCollections.reduce((sum, row) => sum + Number(row.amount || 0), 0)),
    totalDue: roundMoney(emiOutstanding),
    dueAmount: roundMoney(emiOutstanding),
    emiDue: roundMoney(emiOutstanding),
    cashDue: 0,
    upcomingDue: roundMoney(upcomingDue),
    overdueAmount: roundMoney(overdueAmount),
    totalOverdueAmount: roundMoney(overdueAmount),
    overdueCount: overdueSchedules.length,
    overdueLoanCount: new Set(overdueSchedules.map((row) => idOf(row.loanId)).filter(Boolean)).size,
    activeEmis: activeLoans.length,
    activeLoanCount: activeLoans.length,
    totalEmiAmount: roundMoney(emiContractValue),
    emiContractValue: roundMoney(emiContractValue),
    emiFinanceCharge: roundMoney(emiFinanceCharge),
    outstandingLateFees: roundMoney(outstandingLateFees),
    lateFeesAssessed: roundMoney(lateFeesAssessed),
    accountingExpectedPosition: roundMoney(expectedPosition),
    accountingActualPosition: roundMoney(actualPosition),
    accountingDifference: roundMoney(actualPosition - expectedPosition),
    totalFinancedAmount: roundMoney(
      saleLoans.reduce((sum, loan) => sum + Math.max(Number(loan.principal || 0) - Number(loan.downPayment || 0), 0), 0)
    ),
    paidOrderCount: paidCashOrders.length,
    paidCashOrderCount: paidCashOrders.length,
    unpaidOrderCount: unpaidCashOrders.length,
    unpaidCashOrderCount: unpaidCashOrders.length,
    unpaidCashOrderValue: roundMoney(unpaidCashOrderValue),
    readyDeliveryCount: validOrders.filter((order) =>
      (order.items || []).some(
        (item) =>
          (!sellerId || idOf(item.sellerId) === idOf(sellerId)) &&
          ["confirmed", "processing"].includes(item.fulfillmentStatus)
      )
    ).length
  };
}

module.exports = {
  COLLECTION_TYPES,
  EMI_COLLECTION_TYPES,
  EXCLUDED_ORDER_STATUSES,
  OPEN_SCHEDULE_STATUSES,
  SALE_LOAN_STATUSES,
  calculateSellerAccounting,
  scheduleBalance,
  sellerOrderFinancials
};
