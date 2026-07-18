const PDFDocument = require("pdfkit");

const COLORS = {
  ink: "#173a34",
  inkSoft: "#254e47",
  primary: "#218671",
  primarySoft: "#e9f5f2",
  accent: "#d8a743",
  canvas: "#f5f8f7",
  border: "#d8e4e1",
  muted: "#657a75",
  white: "#ffffff",
  danger: "#a73737",
  warning: "#95600c",
  success: "#26704f"
};

const REPORT_DEFINITIONS = {
  sales: {
    title: "Sales performance report",
    shortTitle: "Sales report",
    description: "Recognized cash product sales and active EMI principal",
    basis: "Cash sales are included after confirmed payment. EMI sales are recognized after loan activation. Delivery charges are excluded.",
    columns: [
      { key: "date", label: "Date", width: 62, format: "date" },
      { key: "reference", label: "Reference", width: 100 },
      { key: "saleType", label: "Type", width: 44 },
      { key: "buyer", label: "Buyer", width: 110 },
      { key: "product", label: "Product", width: 190 },
      { key: "principal", label: "Sale value", width: 82, format: "money", align: "right" },
      { key: "contractValue", label: "Contract", width: 90, format: "money", align: "right" },
      { key: "status", label: "Status", width: 80, format: "status" }
    ]
  },
  collections: {
    title: "Collection report",
    shortTitle: "Collections",
    description: "Confirmed cash, down-payment, and installment receipts",
    basis: "Only confirmed transaction records are included. Refunded, failed, and pending transactions are excluded.",
    columns: [
      { key: "date", label: "Date", width: 62, format: "date" },
      { key: "reference", label: "Receipt", width: 130 },
      { key: "buyer", label: "Buyer", width: 140 },
      { key: "transactionType", label: "Collection type", width: 145 },
      { key: "method", label: "Method", width: 100 },
      { key: "amount", label: "Amount", width: 96, format: "money", align: "right" },
      { key: "status", label: "Status", width: 85, format: "status" }
    ]
  },
  overdue: {
    title: "Overdue and risk report",
    shortTitle: "Overdue report",
    description: "Past-due EMI balances with late fees and risk classification",
    basis: "Outstanding balance equals installment due plus assessed late fee less payments already allocated.",
    columns: [
      { key: "date", label: "Due date", width: 62, format: "date" },
      { key: "reference", label: "Loan / EMI", width: 92 },
      { key: "buyer", label: "Buyer", width: 105 },
      { key: "product", label: "Product", width: 145 },
      { key: "installmentNo", label: "EMI", width: 44, align: "center" },
      { key: "daysOverdue", label: "Days", width: 72, align: "right" },
      { key: "lateFee", label: "Late fee", width: 82, format: "money", align: "right" },
      { key: "balance", label: "Outstanding", width: 92, format: "money", align: "right" },
      { key: "riskCategory", label: "Risk", width: 64, format: "status" }
    ]
  },
  orders: {
    title: "Order and fulfillment report",
    shortTitle: "Order report",
    description: "Seller-scoped order value, payment, and delivery progress",
    basis: "Amounts contain only this seller's non-cancelled product items. Platform-wide order totals are not used for multi-seller orders.",
    columns: [
      { key: "date", label: "Date", width: 62, format: "date" },
      { key: "reference", label: "Order", width: 90 },
      { key: "buyer", label: "Buyer", width: 105 },
      { key: "product", label: "Seller items", width: 175 },
      { key: "paymentMode", label: "Mode", width: 58 },
      { key: "amount", label: "Item value", width: 84, format: "money", align: "right" },
      { key: "paymentStatus", label: "Payment", width: 84, format: "status" },
      { key: "fulfillmentStatus", label: "Fulfillment", width: 100, format: "status" }
    ]
  },
  "emi-portfolio": {
    title: "EMI portfolio report",
    shortTitle: "EMI portfolio",
    description: "Loan principal, contract value, and current outstanding exposure",
    basis: "Outstanding values are calculated from open EMI schedule balances, including assessed late fees.",
    columns: [
      { key: "date", label: "Started", width: 62, format: "date" },
      { key: "reference", label: "Loan", width: 95 },
      { key: "buyer", label: "Buyer", width: 105 },
      { key: "product", label: "Product", width: 160 },
      { key: "tenureMonths", label: "Tenure", width: 75, format: "months" },
      { key: "principal", label: "Principal", width: 80, format: "money", align: "right" },
      { key: "outstanding", label: "Outstanding", width: 84, format: "money", align: "right" },
      { key: "status", label: "Status", width: 97, format: "status" }
    ]
  },
  "down-payments": {
    title: "EMI down-payment report",
    shortTitle: "Down payments",
    description: "Confirmed initial payments used to activate approved EMI purchases",
    basis: "Only confirmed down-payment transactions are included.",
    columns: [
      { key: "date", label: "Date", width: 72, format: "date" },
      { key: "reference", label: "Receipt", width: 120 },
      { key: "loanReference", label: "Loan", width: 120 },
      { key: "buyer", label: "Buyer", width: 140 },
      { key: "method", label: "Method", width: 90 },
      { key: "amount", label: "Amount", width: 116, format: "money", align: "right" },
      { key: "status", label: "Status", width: 100, format: "status" }
    ]
  }
};

function getReportDefinition(type) {
  return REPORT_DEFINITIONS[type] || REPORT_DEFINITIONS.collections;
}

function createReportDocument({ type, rows = [], organization = {}, filters = {}, generatedBy = {}, generatedAt = new Date() }) {
  const definition = getReportDefinition(type);
  const reference = reportReference(type, generatedAt);
  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: 0,
    bufferPages: true,
    info: {
      Title: `${definition.title} - ${organization.name || "FinanceLend"}`,
      Author: organization.name || "FinanceLend EMI Management",
      Subject: definition.description,
      Keywords: `FinanceLend, ${type}, EMI, business report`,
      CreationDate: generatedAt
    }
  });

  drawFirstPageHeader(doc, { definition, organization, filters, generatedBy, generatedAt, reference });
  drawSummaryCards(doc, type, rows, 207);
  drawTable(doc, definition, rows, {
    firstPageY: 292,
    onNewPage: () => drawContinuationHeader(doc, definition, organization, reference)
  });
  drawReportFooters(doc, { reference, generatedAt });
  return doc;
}

function drawFirstPageHeader(doc, context) {
  const { definition, organization, filters, generatedBy, generatedAt, reference } = context;
  const pageWidth = doc.page.width;

  doc.rect(0, 0, pageWidth, 72).fill(COLORS.ink);
  doc.rect(0, 72, pageWidth, 4).fill(COLORS.accent);
  doc.roundedRect(42, 18, 38, 38, 6).fill(COLORS.white);
  doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(13).text("FL", 51, 31, { width: 20, align: "center" });
  doc.fillColor(COLORS.white).font("Helvetica-Bold").fontSize(18).text("FinanceLend", 94, 19);
  doc.fillColor("#cce0dc").font("Helvetica").fontSize(8).text("EMI & COMMERCE MANAGEMENT", 94, 43);
  doc.fillColor(COLORS.white).font("Helvetica-Bold").fontSize(10).text(organization.name || "Business report", 500, 20, {
    width: 300,
    align: "right"
  });
  doc.fillColor("#cce0dc").font("Helvetica").fontSize(8).text(organization.address || organization.email || "", 500, 40, {
    width: 300,
    align: "right"
  });

  doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(22).text(definition.title, 42, 96);
  doc.fillColor(COLORS.muted).font("Helvetica").fontSize(9).text(definition.description, 42, 126);
  doc.fillColor(COLORS.primary).font("Helvetica-Bold").fontSize(8.5).text(reference, 600, 101, { width: 200, align: "right" });

  const period = reportPeriod(filters);
  const metadata = [
    ["Reporting period", period],
    ["Generated", formatDateTime(generatedAt)],
    ["Prepared for", organization.name || generatedBy.name || "FinanceLend user"],
    ["Prepared by", generatedBy.name || generatedBy.email || "FinanceLend system"]
  ];
  const boxY = 151;
  const boxWidth = 185;
  metadata.forEach(([label, value], index) => {
    const x = 42 + index * 190;
    doc.roundedRect(x, boxY, boxWidth, 39, 5).fill(COLORS.canvas);
    doc.fillColor(COLORS.muted).font("Helvetica-Bold").fontSize(7).text(label.toUpperCase(), x + 10, boxY + 8, { width: boxWidth - 20 });
    doc.fillColor(COLORS.ink).font("Helvetica").fontSize(8.5).text(truncate(value, 36), x + 10, boxY + 21, { width: boxWidth - 20 });
  });
}

function drawSummaryCards(doc, type, rows, y) {
  const summaries = getReportSummary(type, rows);
  const cardGap = 10;
  const cardWidth = (758 - cardGap * 3) / 4;
  summaries.slice(0, 4).forEach((summary, index) => {
    const x = 42 + index * (cardWidth + cardGap);
    doc.roundedRect(x, y, cardWidth, 61, 6).fill(index === 0 ? COLORS.primarySoft : COLORS.white);
    doc.roundedRect(x, y, cardWidth, 61, 6).lineWidth(0.7).strokeColor(COLORS.border).stroke();
    doc.fillColor(COLORS.muted).font("Helvetica-Bold").fontSize(7.5).text(summary.label.toUpperCase(), x + 12, y + 11, { width: cardWidth - 24 });
    doc.fillColor(index === 0 ? COLORS.primary : COLORS.ink).font("Helvetica-Bold").fontSize(summary.money ? 15 : 17).text(
      summary.money ? formatMoney(summary.value) : formatNumber(summary.value),
      x + 12,
      y + 31,
      { width: cardWidth - 24 }
    );
  });
}

function drawTable(doc, definition, rows, options) {
  let y = options.firstPageY;
  const tableBottom = 535;
  const rowHeight = 28;

  drawTableHeader(doc, definition.columns, y);
  y += 27;

  if (!rows.length) {
    doc.rect(42, y, 758, 74).fill(COLORS.canvas);
    doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(11).text("No records found", 42, y + 22, { width: 758, align: "center" });
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8.5).text("No report rows match the selected reporting period.", 42, y + 41, {
      width: 758,
      align: "center"
    });
    return;
  }

  rows.forEach((row, index) => {
    if (y + rowHeight > tableBottom) {
      doc.addPage();
      options.onNewPage();
      y = 92;
      drawTableHeader(doc, definition.columns, y);
      y += 27;
    }

    doc.rect(42, y, 758, rowHeight).fill(index % 2 === 1 ? COLORS.canvas : COLORS.white);
    let x = 42;
    definition.columns.forEach((column) => {
      drawTableCell(doc, column, row[column.key], x, y, rowHeight);
      x += column.width;
    });
    doc.moveTo(42, y + rowHeight).lineTo(800, y + rowHeight).lineWidth(0.4).strokeColor(COLORS.border).stroke();
    y += rowHeight;
  });

  const noteHeight = 36;
  if (y + noteHeight <= tableBottom) {
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(7.5).text(`Reporting basis: ${definition.basis}`, 42, y + 12, {
      width: 758,
      align: "left"
    });
  }
}

function drawTableHeader(doc, columns, y) {
  doc.rect(42, y, 758, 27).fill(COLORS.inkSoft);
  let x = 42;
  columns.forEach((column) => {
    doc.fillColor(COLORS.white).font("Helvetica-Bold").fontSize(7).text(column.label.toUpperCase(), x + 6, y + 9, {
      width: column.width - 12,
      align: column.align || "left",
      lineBreak: false
    });
    x += column.width;
  });
}

function drawTableCell(doc, column, rawValue, x, y, height) {
  const formatted = formatReportValue(rawValue, column.format);
  const color = column.format === "status" ? statusColor(rawValue) : COLORS.ink;
  doc.fillColor(color).font(column.format === "status" ? "Helvetica-Bold" : "Helvetica").fontSize(7.5).text(
    truncate(formatted, Math.max(5, Math.floor((column.width - 12) / 4.5))),
    x + 6,
    y + 10,
    {
      width: column.width - 12,
      align: column.align || "left",
      lineBreak: false
    }
  );
}

function drawContinuationHeader(doc, definition, organization, reference) {
  doc.rect(0, 0, doc.page.width, 58).fill(COLORS.ink);
  doc.rect(0, 58, doc.page.width, 3).fill(COLORS.accent);
  doc.fillColor(COLORS.white).font("Helvetica-Bold").fontSize(13).text("FinanceLend", 42, 18);
  doc.fillColor("#cce0dc").font("Helvetica").fontSize(8).text(definition.shortTitle, 42, 37);
  doc.fillColor(COLORS.white).font("Helvetica-Bold").fontSize(9).text(organization.name || reference, 500, 20, { width: 300, align: "right" });
}

function drawReportFooters(doc, { reference, generatedAt }) {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const footerY = doc.page.height - 36;
    doc.moveTo(42, footerY - 7).lineTo(800, footerY - 7).lineWidth(0.6).strokeColor(COLORS.border).stroke();
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(7);
    doc.text(`${reference} | Generated ${formatDateTime(generatedAt)} | Amounts in BDT`, 42, footerY, {
      width: 560,
      lineBreak: false
    });
    doc.text(`Page ${index + 1} of ${range.count}`, 680, footerY, { width: 120, align: "right", lineBreak: false });
  }
}

function getReportSummary(type, rows = []) {
  const sum = (key, predicate = () => true) => rows.filter(predicate).reduce((total, row) => total + Number(row[key] || 0), 0);
  const count = (predicate) => rows.filter(predicate).length;
  if (type === "sales") {
    return [
      { label: "Recognized sales", value: sum("principal"), money: true },
      { label: "Cash product sales", value: sum("principal", (row) => row.saleType === "Cash"), money: true },
      { label: "EMI principal", value: sum("principal", (row) => row.saleType === "EMI"), money: true },
      { label: "Sales records", value: rows.length }
    ];
  }
  if (type === "overdue") {
    return [
      { label: "Outstanding", value: sum("balance"), money: true },
      { label: "Late fees", value: sum("lateFee"), money: true },
      { label: "Overdue installments", value: rows.length },
      { label: "High / critical risk", value: count((row) => ["high", "critical"].includes(row.riskCategory)) }
    ];
  }
  if (type === "orders") {
    return [
      { label: "Seller item value", value: sum("amount"), money: true },
      { label: "Orders", value: rows.length },
      { label: "Paid orders", value: count((row) => row.paymentStatus === "paid") },
      { label: "Delivered orders", value: count((row) => row.fulfillmentStatus === "delivered") }
    ];
  }
  if (type === "emi-portfolio") {
    return [
      { label: "Outstanding", value: sum("outstanding"), money: true },
      { label: "Portfolio principal", value: sum("principal"), money: true },
      { label: "Active loans", value: count((row) => row.status === "active") },
      { label: "Total loans", value: rows.length }
    ];
  }
  if (type === "down-payments") {
    return [
      { label: "Down payments", value: sum("amount"), money: true },
      { label: "Receipts", value: rows.length },
      { label: "Stripe payments", value: count((row) => String(row.method).toLowerCase() === "stripe") },
      { label: "Average payment", value: rows.length ? sum("amount") / rows.length : 0, money: true }
    ];
  }
  return [
    { label: "Total collected", value: sum("amount"), money: true },
    { label: "Receipts", value: rows.length },
    { label: "Cash order receipts", value: sum("amount", (row) => row.transactionType === "Cash order"), money: true },
    { label: "EMI receipts", value: sum("amount", (row) => row.transactionType !== "Cash order"), money: true }
  ];
}

function formatReportValue(value, format) {
  if (format === "money") return formatMoney(value);
  if (format === "date") return formatDate(value);
  if (format === "months") return `${Number(value || 0)} mo`;
  if (format === "status") return titleCase(value);
  if (value === undefined || value === null || value === "") return "-";
  return String(value);
}

function formatMoney(value) {
  return `BDT ${Math.round(Number(value || 0)).toLocaleString("en-BD")}`;
}

function formatNumber(value) {
  return Math.round(Number(value || 0)).toLocaleString("en-BD");
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Dhaka"
  }).format(new Date(value));
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Dhaka"
  }).format(new Date(value));
}

function reportPeriod(filters) {
  if (filters.from && filters.to) return `${formatDate(filters.from)} to ${formatDate(filters.to)}`;
  if (filters.from) return `From ${formatDate(filters.from)}`;
  if (filters.to) return `Through ${formatDate(filters.to)}`;
  return "All available records";
}

function reportReference(type, generatedAt) {
  const timestamp = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Dhaka"
  })
    .format(generatedAt)
    .replace(/\D/g, "");
  return `RPT-${String(type).replaceAll("-", "").toUpperCase()}-${timestamp}`;
}

function titleCase(value) {
  if (value === undefined || value === null || value === "") return "-";
  return String(value)
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusColor(value) {
  const status = String(value || "").toLowerCase();
  if (["paid", "confirmed", "active", "closed", "delivered", "low"].includes(status)) return COLORS.success;
  if (["overdue", "defaulted", "rejected", "failed", "critical", "high"].includes(status)) return COLORS.danger;
  if (["pending", "partial", "requested", "approved", "medium", "processing"].includes(status)) return COLORS.warning;
  return COLORS.ink;
}

function truncate(value, maxLength) {
  const stringValue = String(value || "-");
  if (stringValue.length <= maxLength) return stringValue;
  return `${stringValue.slice(0, Math.max(1, maxLength - 1))}...`;
}

module.exports = {
  REPORT_DEFINITIONS,
  createReportDocument,
  formatReportValue,
  getReportDefinition,
  getReportSummary
};
