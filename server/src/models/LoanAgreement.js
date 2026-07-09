const mongoose = require("mongoose");

const loanAgreementSchema = new mongoose.Schema(
  {
    loanId: { type: mongoose.Schema.Types.ObjectId, ref: "Loan", required: true, unique: true, index: true },
    agreementNo: { type: String, required: true, unique: true, index: true },
    pdfPath: String,
    terms: { type: String, required: true },
    guarantorName: { type: String, default: "" },
    guarantorPhone: { type: String, default: "" },
    acceptedByBuyerAt: Date,
    acceptedBySellerAt: Date
  },
  { timestamps: true }
);

module.exports = mongoose.model("LoanAgreement", loanAgreementSchema);
