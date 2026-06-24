import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { api } from "../api/http";
import StatusBadge from "../components/StatusBadge.jsx";
import StatCard from "../components/StatCard.jsx";
import { generateReceiptPdf } from "../utils/receipt.js";

export default function BuyerPortal() {
  const queryClient = useQueryClient();
  const [kycType, setKycType] = useState("nid");
  const [files, setFiles] = useState([]);
  const loans = useQuery({ queryKey: ["buyer-loans"], queryFn: async () => (await api.get("/loans")).data });
  const payments = useQuery({ queryKey: ["payments"], queryFn: async () => (await api.get("/payments")).data });
  const kyc = useQuery({ queryKey: ["kyc"], queryFn: async () => (await api.get("/kyc/mine")).data });
  const summary = useQuery({ queryKey: ["buyer-summary"], queryFn: async () => (await api.get("/reports/summary")).data });

  const uploadKyc = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append("type", kycType);
      Array.from(files).forEach((file) => form.append("documents", file));
      return api.post("/kyc", form, { headers: { "Content-Type": "multipart/form-data" } });
    },
    onSuccess: () => {
      setFiles([]);
      queryClient.invalidateQueries({ queryKey: ["kyc"] });
    }
  });

  const mockPay = useMutation({
    mutationFn: async (loanId) => api.post("/payments/mock-gateway", { loanId, amount: 1000 }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["buyer-loans"] });
      queryClient.invalidateQueries({ queryKey: ["buyer-summary"] });
      queryClient.invalidateQueries({ queryKey: ["payments"] });
    }
  });

  return (
    <section className="dashboard">
      <div className="page-title">
        <div>
          <h1>Buyer Portal</h1>
          <p>Manage KYC documents, EMI requests, schedules, online payments, and receipts.</p>
        </div>
      </div>
      <div className="stats-grid">
        <StatCard label="Active EMIs" value={summary.data?.activeEmis ?? 0} />
        <StatCard label="Due amount" value={`BDT ${Math.round(summary.data?.dueAmount || 0)}`} tone="green" />
        <StatCard label="Overdues" value={summary.data?.overdueCount ?? 0} tone="red" />
        <StatCard label="Paid this month" value={`BDT ${Math.round(summary.data?.monthlyCollection || 0)}`} tone="purple" />
      </div>

      <div className="work-grid">
        <section className="panel">
          <h2>KYC upload</h2>
          <div className="form-grid compact">
            <select value={kycType} onChange={(e) => setKycType(e.target.value)}><option value="nid">NID</option><option value="passport">Passport</option></select>
            <input type="file" multiple accept=".jpg,.jpeg,.png,.pdf" onChange={(e) => setFiles(e.target.files)} />
          </div>
          <button className="button" onClick={() => uploadKyc.mutate()} disabled={!files.length || uploadKyc.isPending}>Upload documents</button>
          <div className="list-stack">
            {(kyc.data || []).map((doc) => <div className="list-row" key={doc._id}><span>{doc.type.toUpperCase()}</span><StatusBadge status={doc.status} /></div>)}
          </div>
        </section>

        <section className="panel">
          <h2>My EMI loans</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Seller</th><th>Product</th><th>Total</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>{(loans.data || []).map((loan) => <tr key={loan._id}><td>{loan.sellerId?.name}</td><td>{loan.productId?.name || "Offline loan"}</td><td>BDT {loan.totalPayable}</td><td><StatusBadge status={loan.status} /></td><td style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}><Link className="button tiny" to={`/loans/${loan._id}`}>View schedule</Link><button className="button tiny" disabled={loan.status !== "active"} onClick={() => mockPay.mutate(loan._id)}>Pay 1000</button></td></tr>)}</tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="panel">
        <h2>Payment history</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Receipt</th><th>Loan</th><th>Amount</th><th>Method</th><th>Date</th><th>Action</th></tr>
            </thead>
            <tbody>
              {(payments.data || []).length === 0 ? (
                <tr><td colSpan="6" style={{ textAlign: "center", color: "#888" }}>No payments recorded yet</td></tr>
              ) : (
                (payments.data || []).map((payment) => (
                  <tr key={payment._id}>
                    <td>{payment.receiptNo || "-"}</td>
                    <td>{payment.loanId?._id || payment.loanId}</td>
                    <td>BDT {payment.amount}</td>
                    <td>{payment.method}</td>
                    <td>{dayjs(payment.paymentDate).format("DD MMM YYYY")}</td>
                    <td><button className="button tiny" onClick={() => generateReceiptPdf(payment)}>Download</button></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
