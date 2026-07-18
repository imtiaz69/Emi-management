const PDFDocument = require("pdfkit");

const COLORS = {
  ink: "#183a33",
  muted: "#60766f",
  primary: "#17846f",
  primarySoft: "#e8f5f1",
  border: "#d8e5e1",
  white: "#ffffff",
  warning: "#a45f09"
};

function text(value, fallback = "-") {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value);
}

function money(value) {
  return `BDT ${Math.round(Number(value || 0)).toLocaleString("en-BD")}`;
}

function dateTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Dhaka"
  }).format(new Date(value));
}

function dateOnly(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Dhaka"
  }).format(new Date(value));
}

function createDocument(options = {}) {
  return new PDFDocument({
    size: "A4",
    margin: 46,
    bufferPages: true,
    info: {
      Title: options.title || "FinanceLend Document",
      Author: "FinanceLend EMI Management",
      Subject: options.subject || "Official finance document"
    }
  });
}

function drawBrandHeader(doc, label) {
  const top = 38;
  doc.roundedRect(46, top, 38, 38, 6).fill(COLORS.ink);
  doc.fillColor(COLORS.white).font("Helvetica-Bold").fontSize(13).text("FL", 56, top + 12, { width: 20, align: "center" });
  doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(16).text("FinanceLend", 96, top + 2);
  doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8).text("EMI & LOAN MANAGEMENT PLATFORM", 96, top + 23);
  doc.fillColor(COLORS.primary).font("Helvetica-Bold").fontSize(9).text(label.toUpperCase(), 360, top + 13, { width: 188, align: "right" });
  doc.moveTo(46, 88).lineTo(549, 88).lineWidth(1).strokeColor(COLORS.border).stroke();
  doc.y = 108;
}

function drawFooter(doc, reference) {
  const range = doc.bufferedPageRange();
  for (let pageIndex = range.start; pageIndex < range.start + range.count; pageIndex += 1) {
    doc.switchToPage(pageIndex);
    doc.moveTo(46, 772).lineTo(549, 772).lineWidth(0.7).strokeColor(COLORS.border).stroke();
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8);
    doc.text(`Reference: ${text(reference)}`, 46, 780, { width: 330, lineBreak: false });
    doc.text(`Page ${pageIndex + 1} of ${range.count}`, 420, 780, { width: 129, align: "right", lineBreak: false });
  }
}

function detailRow(doc, label, value, y, options = {}) {
  const rowHeight = options.height || 31;
  doc.rect(46, y, 503, rowHeight).fill(options.alt ? "#f7faf9" : COLORS.white);
  doc.fillColor(COLORS.muted).font("Helvetica-Bold").fontSize(8.5).text(label.toUpperCase(), 58, y + 10, { width: 150 });
  doc.fillColor(COLORS.ink).font("Helvetica").fontSize(9.5).text(text(value), 214, y + 9, { width: 322, align: "right" });
  doc.moveTo(46, y + rowHeight).lineTo(549, y + rowHeight).lineWidth(0.5).strokeColor(COLORS.border).stroke();
}

function createReceiptDocument(transaction) {
  const receiptNo = transaction.receiptNo || transaction._id;
  const doc = createDocument({ title: `Payment Receipt ${receiptNo}`, subject: "Official payment receipt" });
  drawBrandHeader(doc, "Official payment receipt");

  doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(24).text("Payment receipt", 46, 112);
  doc.fillColor(COLORS.muted).font("Helvetica").fontSize(9).text("System-generated confirmation for a completed FinanceLend payment.", 46, 143);

  doc.roundedRect(46, 174, 503, 86, 7).fill(COLORS.primarySoft);
  doc.fillColor(COLORS.muted).font("Helvetica-Bold").fontSize(9).text("AMOUNT PAID", 62, 190);
  doc.fillColor(COLORS.primary).font("Helvetica-Bold").fontSize(25).text(money(transaction.amount), 62, 209);
  doc.fillColor(COLORS.primary).font("Helvetica-Bold").fontSize(10).text(text(transaction.status, "confirmed").toUpperCase(), 410, 206, { width: 120, align: "right" });
  doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8.5).text("Payment status", 410, 222, { width: 120, align: "right" });

  let y = 286;
  const reference = transaction.loanId
    ? `Loan ${transaction.loanId?._id || transaction.loanId}`
    : `Order ${transaction.orderId?.orderNo || transaction.orderId?._id || transaction.orderId}`;
  const paymentType = text(transaction.transactionType).replaceAll("_", " ");
  const productName = transaction.loanId?.productId?.name || transaction.orderId?.items?.[0]?.name || "-";
  const scheduleLabel = transaction.allocations?.length
    ? transaction.allocations.map((allocation) => `#${allocation.installmentNo} (${money(allocation.amount)})`).join(", ")
    : transaction.scheduleId?.installmentNo
      ? `Installment ${transaction.scheduleId.installmentNo}`
      : "-";
  const rows = [
    ["Receipt number", receiptNo],
    ["Payment date", dateTime(transaction.paymentDate)],
    ["Payment for", `${paymentType} - ${reference}`],
    ["Product", productName],
    ["EMI allocation", scheduleLabel],
    ["Buyer", transaction.buyerId?.name || transaction.buyerId?.email],
    ["Seller", transaction.sellerId?.name || transaction.sellerId?.email],
    ["Payment method", text(transaction.method).replaceAll("_", " ").toUpperCase()],
    ["Gateway reference", transaction.gatewayRef || "Not applicable"]
  ];
  rows.forEach(([label, value], index) => {
    const rowHeight = label === "EMI allocation" && String(value).length > 48 ? 48 : 31;
    detailRow(doc, label, value, y, { alt: index % 2 === 1, height: rowHeight });
    y += rowHeight;
  });

  if (transaction.notes) {
    doc.fillColor(COLORS.muted).font("Helvetica-Bold").fontSize(8.5).text("PAYMENT NOTE", 46, y + 18);
    doc.roundedRect(46, y + 34, 503, 48, 5).fill("#f7faf9");
    doc.fillColor(COLORS.ink).font("Helvetica").fontSize(9).text(text(transaction.notes), 58, y + 47, { width: 479 });
    y += 96;
  }

  doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8.5).text(
    "This receipt was generated from a confirmed transaction stored by FinanceLend. Keep the receipt number for future payment support and reconciliation.",
    46,
    Math.min(y + 18, 755),
    { width: 503, align: "center", lineGap: 2 }
  );
  drawFooter(doc, receiptNo);
  return doc;
}

function ensureAgreementSpace(doc, requiredHeight, agreementNo) {
  if (doc.y + requiredHeight <= 760) return;
  doc.addPage();
  drawBrandHeader(doc, `Loan agreement ${agreementNo}`);
}

function agreementSectionTitle(doc, title) {
  ensureAgreementSpace(doc, 46);
  doc.moveDown(0.35);
  doc.fillColor(COLORS.primary).font("Helvetica-Bold").fontSize(10).text(title.toUpperCase(), { characterSpacing: 0.4 });
  doc.moveDown(0.35);
}

function agreementKeyValue(doc, label, value) {
  ensureAgreementSpace(doc, 25);
  const y = doc.y;
  doc.fillColor(COLORS.muted).font("Helvetica-Bold").fontSize(8.5).text(label.toUpperCase(), 46, y, { width: 170 });
  doc.fillColor(COLORS.ink).font("Helvetica").fontSize(9.5).text(text(value), 216, y, { width: 333, align: "right" });
  doc.y = Math.max(doc.y, y + 18);
  doc.moveTo(46, doc.y).lineTo(549, doc.y).lineWidth(0.45).strokeColor(COLORS.border).stroke();
  doc.y += 7;
}

function drawScheduleHeader(doc) {
  const y = doc.y;
  doc.rect(46, y, 503, 24).fill(COLORS.ink);
  doc.fillColor(COLORS.white).font("Helvetica-Bold").fontSize(7.5);
  doc.text("#", 54, y + 8, { width: 24 });
  doc.text("Due date", 82, y + 8, { width: 88 });
  doc.text("Principal", 182, y + 8, { width: 92, align: "right" });
  doc.text("Interest", 284, y + 8, { width: 88, align: "right" });
  doc.text("Installment", 384, y + 8, { width: 153, align: "right" });
  doc.y = y + 24;
}

function createAgreementDocument({ loan, agreement, schedules, buyerProfile, sellerProfile }) {
  const doc = createDocument({
    title: `Loan Agreement ${agreement.agreementNo}`,
    subject: "EMI purchase and repayment agreement"
  });
  drawBrandHeader(doc, "EMI purchase agreement");

  doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(23).text("EMI purchase agreement", 46, 112);
  doc.fillColor(COLORS.muted).font("Helvetica").fontSize(9).text(
    `Agreement ${agreement.agreementNo} | Issued ${dateOnly(agreement.createdAt)}`,
    46,
    143
  );

  doc.roundedRect(46, 172, 503, 64, 7).fill(COLORS.primarySoft);
  doc.fillColor(COLORS.muted).font("Helvetica-Bold").fontSize(8.5).text("TOTAL EMI OBLIGATION", 60, 187);
  doc.fillColor(COLORS.primary).font("Helvetica-Bold").fontSize(20).text(money(loan.totalPayable), 60, 205);
  doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8.5).text(`${loan.tenureMonths} monthly installments`, 374, 196, { width: 158, align: "right" });
  doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(10).text(`${loan.interestRate}% ${text(loan.interestType).toUpperCase()}`, 374, 212, { width: 158, align: "right" });
  doc.y = 257;

  agreementSectionTitle(doc, "1. Contracting parties");
  agreementKeyValue(doc, "Buyer", `${loan.buyerId?.name || "-"} | ${loan.buyerId?.email || "-"} | ${loan.buyerId?.phone || "-"}`);
  agreementKeyValue(doc, "Buyer address", buyerProfile?.address || loan.orderId?.shippingAddress?.line1 || "-");
  agreementKeyValue(doc, "Seller", `${sellerProfile?.shopName || loan.sellerId?.name || "-"} | ${loan.sellerId?.email || "-"} | ${loan.sellerId?.phone || "-"}`);
  agreementKeyValue(doc, "Seller address", sellerProfile?.address || "-");

  agreementSectionTitle(doc, "2. Product and finance details");
  agreementKeyValue(doc, "Product", loan.productId?.name || "Custom/offline finance");
  agreementKeyValue(doc, "Order", loan.orderId?.orderNo || "Offline loan");
  agreementKeyValue(doc, "Selected color", loan.selectedColorName || "Not applicable");
  agreementKeyValue(doc, "Product price / principal", money(loan.principal));
  agreementKeyValue(doc, "Down payment", money(loan.downPayment));
  agreementKeyValue(doc, "Financed balance", money(Number(loan.principal || 0) - Number(loan.downPayment || 0)));
  agreementKeyValue(doc, "Interest", `${loan.interestRate}% (${text(loan.interestType).replaceAll("_", " ")})`);
  agreementKeyValue(doc, "Tenure", `${loan.tenureMonths} months`);
  agreementKeyValue(doc, "Total payable", money(loan.totalPayable));
  agreementKeyValue(
    doc,
    "Late fee policy",
    loan.lateFeePolicy?.type && loan.lateFeePolicy.type !== "none"
      ? `${text(loan.lateFeePolicy.type)} - ${loan.lateFeePolicy.value}`
      : "No automatic late fee configured"
  );

  agreementSectionTitle(doc, "3. Terms and responsibilities");
  const terms = [
    "The seller will release the financed product for delivery only after the EMI request is approved and the required down payment is confirmed.",
    "The buyer will pay every installment on or before its due date using an approved payment method.",
    "A payment is considered complete only after it is recorded as confirmed in FinanceLend.",
    "Late fees and overdue status may be applied according to the policy stated in this agreement.",
    "The buyer must keep identity, contact, and payment information accurate during the agreement.",
    "Returns, cancellation, refunds, disputes, and product warranty remain subject to the order and store policies.",
    "Both parties accept the schedule below as the repayment plan for this EMI purchase."
  ];
  terms.forEach((term, index) => {
    ensureAgreementSpace(doc, 34, agreement.agreementNo);
    const y = doc.y;
    doc.circle(54, y + 6, 7).fill(COLORS.primarySoft);
    doc.fillColor(COLORS.primary).font("Helvetica-Bold").fontSize(7.5).text(String(index + 1), 49, y + 3, { width: 10, align: "center" });
    doc.fillColor(COLORS.ink).font("Helvetica").fontSize(9).text(term, 70, y, { width: 479, lineGap: 2 });
    doc.y += 8;
  });

  agreementSectionTitle(doc, "4. Repayment schedule");
  drawScheduleHeader(doc);
  schedules.forEach((schedule, index) => {
    ensureAgreementSpace(doc, 27, agreement.agreementNo);
    if (doc.y < 120) drawScheduleHeader(doc);
    const y = doc.y;
    doc.rect(46, y, 503, 25).fill(index % 2 ? "#f7faf9" : COLORS.white);
    doc.fillColor(COLORS.ink).font("Helvetica").fontSize(8);
    doc.text(text(schedule.installmentNo), 54, y + 8, { width: 24 });
    doc.text(dateOnly(schedule.dueDate), 82, y + 8, { width: 88 });
    doc.text(money(schedule.principalAmount), 182, y + 8, { width: 92, align: "right" });
    doc.text(money(schedule.interestAmount), 284, y + 8, { width: 88, align: "right" });
    doc.text(money(schedule.amountDue), 384, y + 8, { width: 153, align: "right" });
    doc.y = y + 25;
  });

  agreementSectionTitle(doc, "5. Acceptance record");
  agreementKeyValue(doc, "Buyer acceptance", agreement.acceptedByBuyerAt ? dateTime(agreement.acceptedByBuyerAt) : "Pending buyer acceptance");
  agreementKeyValue(doc, "Seller acceptance", agreement.acceptedBySellerAt ? dateTime(agreement.acceptedBySellerAt) : "Pending seller acceptance");
  ensureAgreementSpace(doc, 92, agreement.agreementNo);
  const signatureY = doc.y + 28;
  doc.moveTo(46, signatureY).lineTo(260, signatureY).strokeColor(COLORS.border).stroke();
  doc.moveTo(335, signatureY).lineTo(549, signatureY).strokeColor(COLORS.border).stroke();
  doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8.5).text("Buyer signature", 46, signatureY + 8, { width: 214, align: "center" });
  doc.text("Seller signature", 335, signatureY + 8, { width: 214, align: "center" });
  doc.y = signatureY + 42;
  doc.fillColor(COLORS.warning).font("Helvetica-Bold").fontSize(8.5).text(
    "This PDF is the distinct agreement document. Browser page headers, navigation, and dashboard content are not part of this agreement.",
    46,
    doc.y,
    { width: 503, align: "center" }
  );

  drawFooter(doc, agreement.agreementNo);
  return doc;
}

module.exports = {
  createAgreementDocument,
  createReceiptDocument
};
