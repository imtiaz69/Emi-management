import { useEffect, useState } from "react";
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
  const stripeParams = new URLSearchParams(window.location.search);
  const stripeStatus = stripeParams.get("stripe");
  const stripeSessionId = stripeParams.get("session_id");
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

  const stripePay = useMutation({
    mutationFn: async (loanId) => api.post("/payments/stripe/create-checkout-session", { loanId, amount: 1000 }),
    onSuccess: ({ data }) => {
      window.location.href = data.url;
    }
  });

  const confirmStripePayment = useMutation({
    mutationFn: async (sessionId) => api.post("/payments/stripe/confirm-checkout-session", { sessionId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["buyer-loans"] });
      queryClient.invalidateQueries({ queryKey: ["buyer-summary"] });
      queryClient.invalidateQueries({ queryKey: ["payments"] });
    }
  });

  useEffect(() => {
    if (stripeStatus === "success" && stripeSessionId && !confirmStripePayment.isPending && !confirmStripePayment.isSuccess) {
      confirmStripePayment.mutate(stripeSessionId);
    }
  }, [confirmStripePayment, stripeSessionId, stripeStatus]);

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

      {stripeStatus === "success" && (
        <div className="notice success">
          {confirmStripePayment.isSuccess
            ? "Stripe payment recorded successfully. Your EMI schedule and payment history are updated."
            : "Stripe payment completed. Recording it in your EMI account now."}
        </div>
      )}
      {stripeStatus === "cancel" && (
        <div className="notice warning">Stripe payment was cancelled. No EMI payment was recorded.</div>
      )}

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
          <p className="muted">Stripe is in test mode. Use card 4242 4242 4242 4242 with any future expiry and CVC.</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Seller</th><th>Product</th><th>Total</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>{(loans.data || []).map((loan) => <tr key={loan._id}><td>{loan.sellerId?.name}</td><td>{loan.productId?.name || "Offline loan"}</td><td>BDT {loan.totalPayable}</td><td><StatusBadge status={loan.status} /></td><td style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}><Link className="button tiny" to={`/loans/${loan._id}`}>View schedule</Link><button className="button tiny" disabled={loan.status !== "active" || stripePay.isPending} onClick={() => stripePay.mutate(loan._id)}>Pay with Stripe</button><button className="button tiny ghost" disabled={loan.status !== "active" || mockPay.isPending} onClick={() => mockPay.mutate(loan._id)}>Mock pay 1000</button></td></tr>)}</tbody>
            </table>
          </div>
          {stripePay.isError && <p className="form-error">{stripePay.error?.response?.data?.message || "Unable to start Stripe payment"}</p>}
          {confirmStripePayment.isError && <p className="form-error">{confirmStripePayment.error?.response?.data?.message || "Unable to record Stripe payment"}</p>}
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
