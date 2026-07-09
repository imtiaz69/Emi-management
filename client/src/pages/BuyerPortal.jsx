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
  const [profileForm, setProfileForm] = useState({
    address: "",
    nidNumber: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
    monthlyIncome: "",
    occupation: "",
    employmentType: "salaried"
  });
  const [paymentDrafts, setPaymentDrafts] = useState({});
  const stripeParams = new URLSearchParams(window.location.search);
  const stripeStatus = stripeParams.get("stripe");
  const stripeSessionId = stripeParams.get("session_id");
  const loans = useQuery({ queryKey: ["buyer-loans"], queryFn: async () => (await api.get("/loans")).data });
  const payments = useQuery({ queryKey: ["payments"], queryFn: async () => (await api.get("/payments")).data });
  const kyc = useQuery({ queryKey: ["kyc"], queryFn: async () => (await api.get("/kyc/mine")).data });
  const buyerProfile = useQuery({ queryKey: ["buyer-profile"], queryFn: async () => (await api.get("/buyer/profile")).data });
  const applications = useQuery({ queryKey: ["emi-applications"], queryFn: async () => (await api.get("/emi-applications")).data });
  const summary = useQuery({ queryKey: ["buyer-summary"], queryFn: async () => (await api.get("/reports/summary")).data });

  useEffect(() => {
    if (buyerProfile.data?.profile) {
      const profile = buyerProfile.data.profile;
      setProfileForm({
        address: profile.address || "",
        nidNumber: profile.nidNumber || "",
        emergencyContactName: profile.emergencyContactName || "",
        emergencyContactPhone: profile.emergencyContactPhone || "",
        monthlyIncome: profile.monthlyIncome ? String(profile.monthlyIncome) : "",
        occupation: profile.occupation || "",
        employmentType: profile.employmentType || "salaried"
      });
    }
  }, [buyerProfile.data]);

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
      queryClient.invalidateQueries({ queryKey: ["buyer-profile"] });
    }
  });

  const saveProfile = useMutation({
    mutationFn: async () => api.patch("/buyer/profile", { ...profileForm, monthlyIncome: Number(profileForm.monthlyIncome) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["buyer-profile"] });
      alert("Buyer profile saved.");
    },
    onError: (err) => {
      alert(err.response?.data?.message || "Unable to save buyer profile.");
    }
  });

  const mockPay = useMutation({
    mutationFn: async ({ loanId, amount, allocationMode }) => api.post("/payments/mock-gateway", { loanId, amount, allocationMode }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["buyer-loans"] });
      queryClient.invalidateQueries({ queryKey: ["buyer-summary"] });
      queryClient.invalidateQueries({ queryKey: ["payments"] });
    }
  });

  const stripePay = useMutation({
    mutationFn: async ({ loanId, amount, allocationMode }) => api.post("/payments/stripe/create-checkout-session", { loanId, amount, allocationMode }),
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

  function updatePaymentDraft(loanId, patch) {
    setPaymentDrafts((current) => ({ ...current, [loanId]: { allocationMode: "next_due", amount: "", ...(current[loanId] || {}), ...patch } }));
  }

  function getSuggestedAmount(loan, allocationMode) {
    if (allocationMode === "overdue") return loan.paymentSummary?.overdueAmount || 0;
    if (allocationMode === "advance") return loan.paymentSummary?.outstandingAmount || 0;
    return loan.paymentSummary?.nextDueAmount || 0;
  }

  function buildPaymentPayload(loan) {
    const draft = paymentDrafts[loan._id] || {};
    const allocationMode = draft.allocationMode || "next_due";
    const amount = Number(draft.amount || getSuggestedAmount(loan, allocationMode));
    return { loanId: loan._id, allocationMode, amount };
  }

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

      {buyerProfile.data?.readiness && !buyerProfile.data.readiness.ready && (
        <div className="notice warning">
          EMI requests are locked until profile and KYC are complete. Missing: {[...(buyerProfile.data.readiness.missingFields || []), buyerProfile.data.readiness.hasKyc ? null : "KYC upload"].filter(Boolean).join(", ")}.
        </div>
      )}

      <div className="work-grid">
        <section className="panel">
          <h2>Buyer profile</h2>
          <div className="form-grid compact">
            <label>Address
              <input value={profileForm.address} onChange={(e) => setProfileForm({ ...profileForm, address: e.target.value })} placeholder="Example: Akhalia, Sylhet" />
            </label>
            <label>NID number
              <input value={profileForm.nidNumber} onChange={(e) => setProfileForm({ ...profileForm, nidNumber: e.target.value })} placeholder="Example: 1234567890" />
            </label>
            <label>Emergency contact name
              <input value={profileForm.emergencyContactName} onChange={(e) => setProfileForm({ ...profileForm, emergencyContactName: e.target.value })} placeholder="Example: Parent or spouse" />
            </label>
            <label>Emergency contact phone
              <input value={profileForm.emergencyContactPhone} onChange={(e) => setProfileForm({ ...profileForm, emergencyContactPhone: e.target.value })} placeholder="Example: 01700000000" />
            </label>
            <label>Monthly income (BDT)
              <input type="number" value={profileForm.monthlyIncome} onChange={(e) => setProfileForm({ ...profileForm, monthlyIncome: e.target.value })} placeholder="Example: 35000" />
            </label>
            <label>Occupation
              <input value={profileForm.occupation} onChange={(e) => setProfileForm({ ...profileForm, occupation: e.target.value })} placeholder="Example: Software engineer" />
            </label>
            <label>Employment type
              <select value={profileForm.employmentType} onChange={(e) => setProfileForm({ ...profileForm, employmentType: e.target.value })}>
                <option value="salaried">Salaried</option>
                <option value="self_employed">Self employed</option>
                <option value="business_owner">Business owner</option>
                <option value="student">Student</option>
                <option value="unemployed">Unemployed</option>
                <option value="other">Other</option>
              </select>
            </label>
          </div>
          <button className="button" onClick={() => saveProfile.mutate()} disabled={saveProfile.isPending}>Save profile</button>
          <p className="hint">Risk score: {buyerProfile.data?.profile?.riskScore ?? 0} ({buyerProfile.data?.profile?.riskCategory || "low"})</p>
        </section>

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
              <thead><tr><th>Seller</th><th>Product</th><th>Total</th><th>Payable</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {(loans.data || []).map((loan) => {
                  const draft = paymentDrafts[loan._id] || { allocationMode: "next_due", amount: "" };
                  const suggestedAmount = getSuggestedAmount(loan, draft.allocationMode);
                  const paymentPayload = buildPaymentPayload(loan);
                  return (
                    <tr key={loan._id}>
                      <td>{loan.sellerId?.name}</td>
                      <td>{loan.productId?.name || "Offline loan"}</td>
                      <td>BDT {loan.totalPayable}</td>
                      <td>
                        <span>Next: BDT {Math.round(loan.paymentSummary?.nextDueAmount || 0)}</span><br />
                        <span>Overdue: BDT {Math.round(loan.paymentSummary?.overdueAmount || 0)}</span><br />
                        <span>Outstanding: BDT {Math.round(loan.paymentSummary?.outstandingAmount || 0)}</span>
                      </td>
                      <td><StatusBadge status={loan.status} /></td>
                      <td className="table-action-cell">
                        <Link className="button tiny" to={`/loans/${loan._id}`}>View schedule</Link>
                        <select
                          className="mini-input"
                          value={draft.allocationMode}
                          disabled={loan.status !== "active"}
                          onChange={(e) => updatePaymentDraft(loan._id, { allocationMode: e.target.value, amount: String(getSuggestedAmount(loan, e.target.value) || "") })}
                        >
                          <option value="next_due">Next installment</option>
                          <option value="overdue">Overdue balance</option>
                          <option value="advance">Full outstanding</option>
                          <option value="custom">Custom amount</option>
                        </select>
                        <input
                          className="mini-input"
                          type="number"
                          min="1"
                          placeholder={suggestedAmount ? `BDT ${Math.round(suggestedAmount)}` : "Amount"}
                          value={draft.amount}
                          disabled={loan.status !== "active"}
                          onChange={(e) => updatePaymentDraft(loan._id, { amount: e.target.value })}
                        />
                        <button className="button tiny" disabled={loan.status !== "active" || stripePay.isPending || !paymentPayload.amount} onClick={() => stripePay.mutate(paymentPayload)}>Stripe</button>
                        <button className="button tiny ghost" disabled={loan.status !== "active" || mockPay.isPending || !paymentPayload.amount} onClick={() => mockPay.mutate(paymentPayload)}>Mock pay</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {stripePay.isError && <p className="form-error">{stripePay.error?.response?.data?.message || "Unable to start Stripe payment"}</p>}
          {confirmStripePayment.isError && <p className="form-error">{confirmStripePayment.error?.response?.data?.message || "Unable to record Stripe payment"}</p>}
        </section>
      </div>

      <section className="panel">
        <h2>EMI applications</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Product</th><th>Seller</th><th>Principal</th><th>Down payment</th><th>Risk</th><th>Status</th></tr></thead>
            <tbody>
              {(applications.data || []).length === 0 ? (
                <tr><td colSpan="6" style={{ textAlign: "center", color: "#888" }}>No EMI applications yet</td></tr>
              ) : (
                (applications.data || []).map((application) => (
                  <tr key={application._id}>
                    <td>{application.productId?.name || "Offline/custom loan"}</td>
                    <td>{application.sellerId?.name || "-"}</td>
                    <td>BDT {application.requestedPrincipal}</td>
                    <td>BDT {application.downPayment}</td>
                    <td>{application.riskScoreSnapshot} / {application.riskCategorySnapshot}</td>
                    <td><StatusBadge status={application.status} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

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
