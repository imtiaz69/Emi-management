import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { calculateSellerAccounting, sellerOrderFinancials } = require("../services/sellerAccountingService");

const sellerId = "seller-1";

describe("seller accounting", () => {
  it("separates product sales, delivery receipts, EMI collection, and outstanding balances", () => {
    const now = new Date("2026-07-18T12:00:00.000Z");
    const cashOrder = {
      _id: "cash-order",
      paymentStatus: "paid",
      fulfillmentStatus: "delivered",
      discount: 100,
      deliveryCharge: 80,
      items: [
        {
          sellerId,
          financeMode: "cash",
          totalPrice: 1000,
          fulfillmentStatus: "delivered"
        }
      ]
    };
    const unpaidCashOrder = {
      _id: "unpaid-order",
      paymentStatus: "unpaid",
      fulfillmentStatus: "pending",
      discount: 0,
      deliveryCharge: 50,
      items: [
        {
          sellerId,
          financeMode: "cash",
          totalPrice: 500,
          fulfillmentStatus: "pending"
        }
      ]
    };

    const summary = calculateSellerAccounting({
      sellerId,
      now,
      loans: [
        {
          _id: "loan-1",
          status: "active",
          principal: 2000,
          downPayment: 400,
          totalPayable: 1760
        }
      ],
      schedules: [
        {
          loanId: "loan-1",
          dueDate: new Date("2026-07-10T00:00:00.000Z"),
          amountDue: 600,
          amountPaid: 100,
          lateFee: 20,
          status: "overdue"
        },
        {
          loanId: "loan-1",
          dueDate: new Date("2026-08-10T00:00:00.000Z"),
          amountDue: 600,
          amountPaid: 0,
          lateFee: 0,
          status: "pending"
        }
      ],
      transactions: [
        {
          orderId: "cash-order",
          transactionType: "order_payment",
          status: "confirmed",
          amount: 980,
          paymentDate: now
        },
        {
          loanId: "loan-1",
          transactionType: "down_payment",
          status: "confirmed",
          amount: 400,
          paymentDate: now
        },
        {
          loanId: "loan-1",
          transactionType: "installment",
          status: "confirmed",
          amount: 100,
          paymentDate: now
        }
      ],
      orders: [cashOrder, unpaidCashOrder]
    });

    expect(summary.cashSales).toBe(900);
    expect(summary.emiSales).toBe(2000);
    expect(summary.totalSales).toBe(2900);
    expect(summary.cashCollection).toBe(980);
    expect(summary.cashProductCollection).toBe(900);
    expect(summary.deliveryCollection).toBe(80);
    expect(summary.emiCollection).toBe(500);
    expect(summary.totalCollection).toBe(1480);
    expect(summary.overdueAmount).toBe(520);
    expect(summary.upcomingDue).toBe(600);
    expect(summary.totalDue).toBe(1120);
    expect(summary.cashDue).toBe(0);
    expect(summary.unpaidCashOrderValue).toBe(550);
    expect(summary.unpaidCashOrderCount).toBe(1);
    expect(summary.emiContractValue).toBe(2160);
    expect(summary.emiFinanceCharge).toBe(160);
    expect(summary.outstandingLateFees).toBe(20);
    expect(summary.lateFeesAssessed).toBe(20);
    expect(summary.accountingExpectedPosition).toBe(3160);
    expect(summary.accountingActualPosition).toBe(2600);
    expect(summary.accountingDifference).toBe(-560);
  });

  it("allocates discounts and delivery proportionally for a multi-seller order", () => {
    const result = sellerOrderFinancials(
      {
        discount: 300,
        deliveryCharge: 90,
        items: [
          { sellerId: "seller-1", financeMode: "cash", totalPrice: 1000, fulfillmentStatus: "confirmed" },
          { sellerId: "seller-2", financeMode: "cash", totalPrice: 2000, fulfillmentStatus: "confirmed" }
        ]
      },
      "seller-1"
    );

    expect(result.grossProductValue).toBe(1000);
    expect(result.discount).toBe(100);
    expect(result.delivery).toBe(30);
    expect(result.netProductValue).toBe(900);
    expect(result.checkoutValue).toBe(930);
  });

  it("keeps the accounting equation balanced after a late fee is fully collected", () => {
    const summary = calculateSellerAccounting({
      sellerId,
      now: new Date("2026-07-18T12:00:00.000Z"),
      loans: [{ _id: "loan-late", status: "active", principal: 1000, downPayment: 0, totalPayable: 1000 }],
      schedules: [
        {
          loanId: "loan-late",
          dueDate: new Date("2026-06-01T00:00:00.000Z"),
          amountDue: 1000,
          amountPaid: 1100,
          lateFee: 100,
          status: "paid"
        }
      ],
      transactions: [
        {
          loanId: "loan-late",
          transactionType: "installment",
          status: "confirmed",
          amount: 1100,
          paymentDate: new Date("2026-07-01T00:00:00.000Z")
        }
      ],
      orders: []
    });

    expect(summary.lateFeesAssessed).toBe(100);
    expect(summary.outstandingLateFees).toBe(0);
    expect(summary.accountingExpectedPosition).toBe(1100);
    expect(summary.accountingActualPosition).toBe(1100);
    expect(summary.accountingDifference).toBe(0);
  });
});
