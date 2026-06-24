import jsPDF from "jspdf";

export function generateReceiptPdf(transaction) {
  const pdf = new jsPDF({ unit: "pt", format: "A4" });
  const margin = 40;
  const lineHeight = 20;
  const labelX = margin;
  let y = margin;

  pdf.setFontSize(18);
  pdf.text("EMI Management Receipt", margin, y);
  y += lineHeight * 1.5;

  pdf.setFontSize(12);
  pdf.text(`Receipt no: ${transaction.receiptNo || "N/A"}`, labelX, y);
  y += lineHeight;
  pdf.text(`Payment date: ${new Date(transaction.paymentDate).toLocaleString()}`, labelX, y);
  y += lineHeight;
  pdf.text(`Loan ID: ${transaction.loanId?._id || transaction.loanId || "N/A"}`, labelX, y);
  y += lineHeight;
  pdf.text(`Buyer: ${transaction.buyerId?.name || transaction.buyerId?.email || "N/A"}`, labelX, y);
  y += lineHeight;
  pdf.text(`Seller: ${transaction.sellerId?.name || transaction.sellerId?.email || "N/A"}`, labelX, y);
  y += lineHeight;
  pdf.text(`Payment amount: BDT ${transaction.amount}`, labelX, y);
  y += lineHeight;
  pdf.text(`Payment method: ${transaction.method}`, labelX, y);
  y += lineHeight;
  if (transaction.gatewayRef) {
    pdf.text(`Gateway reference: ${transaction.gatewayRef}`, labelX, y);
    y += lineHeight;
  }
  if (transaction.notes) {
    pdf.text(`Notes: ${transaction.notes}`, labelX, y);
    y += lineHeight;
  }

  pdf.setFontSize(10);
  pdf.text("Thank you for using EMI Management.", margin, y + lineHeight);
  pdf.save(`receipt-${transaction.receiptNo || transaction._id || "payment"}.pdf`);
}
