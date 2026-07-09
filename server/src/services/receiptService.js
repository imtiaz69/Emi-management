function buildReceiptPayload(transaction) {
  return {
    receiptNo: transaction.receiptNo,
    amount: transaction.amount,
    method: transaction.method,
    status: transaction.status,
    transactionType: transaction.transactionType,
    paymentDate: transaction.paymentDate,
    buyer: transaction.buyerId,
    seller: transaction.sellerId,
    loanId: transaction.loanId?._id || transaction.loanId
  };
}

module.exports = { buildReceiptPayload };
