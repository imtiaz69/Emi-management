const LoanAgreement = require("../models/LoanAgreement");

function buildAgreementNo() {
  return `AGR-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function buildDefaultTerms(loan) {
  return [
    `Loan principal: BDT ${Math.round(loan.principal)}.`,
    `Down payment: BDT ${Math.round(loan.downPayment || 0)}.`,
    `Tenure: ${loan.tenureMonths} months with ${loan.interestRate}% ${loan.interestType} interest.`,
    "The buyer agrees to pay each installment on or before the due date shown in the EMI schedule.",
    "Late fees may be applied according to the configured late fee policy.",
    "The seller agrees to provide accurate product/order information and receipts for confirmed payments."
  ].join("\n");
}

async function ensureLoanAgreement(loan, { session } = {}) {
  const existing = await LoanAgreement.findOne({ loanId: loan._id }).session(session || null);
  if (existing) return existing;
  const [agreement] = await LoanAgreement.create(
    [
      {
        loanId: loan._id,
        agreementNo: buildAgreementNo(),
        terms: buildDefaultTerms(loan)
      }
    ],
    { session }
  );
  return agreement;
}

module.exports = { buildDefaultTerms, ensureLoanAgreement };
