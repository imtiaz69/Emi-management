import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { CalendarClock, Download, FileSignature, Store } from "lucide-react";
import { api, openProtectedFile } from "../api/http";
import StatusBadge from "../components/StatusBadge.jsx";
import StatCard from "../components/StatCard.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { notifyError, notifySuccess } from "../utils/toast.js";

export default function LoanDetails() {
  const { id } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const loanQuery = useQuery({
    queryKey: ["loan", id],
    queryFn: async () => (await api.get(`/loans/${id}`)).data,
    enabled: Boolean(id)
  });
  const scheduleQuery = useQuery({
    queryKey: ["loan-schedule", id],
    queryFn: async () => (await api.get(`/loans/${id}/schedule`)).data,
    enabled: Boolean(id)
  });
  const agreementAvailable = ["active", "closed"].includes(loanQuery.data?.status);
  const agreementQuery = useQuery({
    queryKey: ["loan-agreement", id],
    queryFn: async () => (await api.get(`/loans/${id}/agreement`)).data,
    enabled: Boolean(id) && agreementAvailable
  });
  const acceptAgreement = useMutation({
    mutationFn: async () => api.patch(`/loans/${id}/agreement/accept`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["loan-agreement", id] });
      notifySuccess("Loan agreement accepted.");
    },
    onError: (err) => notifyError(err, "Unable to accept loan agreement.")
  });

  const loan = loanQuery.data;
  const schedule = scheduleQuery.data || [];
  const agreement = agreementQuery.data;
  const acceptedForRole = user?.role === "buyer" ? agreement?.acceptedByBuyerAt : user?.role === "seller" ? agreement?.acceptedBySellerAt : true;
  const paidAmount = schedule.reduce((sum, row) => sum + Number(row.amountPaid || 0), 0);
  const outstandingAmount = schedule.reduce(
    (sum, row) => sum + Math.max(Number(row.amountDue || 0) + Number(row.lateFee || 0) - Number(row.amountPaid || 0), 0),
    0
  );
  const nextInstallment = schedule.find((row) => ["pending", "partial", "overdue"].includes(row.status));

  if (loanQuery.isLoading) return <section className="dashboard"><div className="panel">Loading loan details...</div></section>;
  if (loanQuery.isError || !loan) return <section className="dashboard"><div className="panel">Loan not found or you do not have access.</div></section>;

  return (
    <section className="dashboard loan-details-page">
      <div className="page-title">
        <div>
          <span className="section-eyebrow">EMI ACCOUNT</span>
          <h1>{loan.productId?.name || "Offline EMI loan"}</h1>
          <p>Loan {loan._id} | Created {dayjs(loan.createdAt).format("DD MMM YYYY")}</p>
        </div>
        <div className="button-row">
          <Link className="button secondary" to={user?.role === "buyer" ? "/buyer?tab=loans" : user?.role === "seller" ? "/seller" : "/admin"}>
            Back
          </Link>
          {agreementAvailable && (
            <button className="button" onClick={() => openProtectedFile(`/loans/${id}/agreement/pdf`)}>
              <Download size={16} /> Agreement PDF
            </button>
          )}
        </div>
      </div>

      <div className="stats-grid">
        <StatCard label="Loan status" value={loan.status} />
        <StatCard label="Principal" value={`BDT ${Math.round(loan.principal || 0).toLocaleString("en-BD")}`} tone="green" />
        <StatCard label="Total EMI payable" value={`BDT ${Math.round(loan.totalPayable || 0).toLocaleString("en-BD")}`} tone="purple" />
        <StatCard label="Paid through schedule" value={`BDT ${Math.round(paidAmount).toLocaleString("en-BD")}`} tone="green" />
        <StatCard label="Outstanding" value={`BDT ${Math.round(outstandingAmount).toLocaleString("en-BD")}`} tone={outstandingAmount ? "red" : "green"} />
        <StatCard
          label="Next EMI"
          value={nextInstallment ? dayjs(nextInstallment.dueDate).format("DD MMM YYYY") : loan.status === "approved" ? "After down payment" : "Completed"}
          tone="purple"
        />
      </div>

      <div className="work-grid">
        <section className="panel">
          <h2>Finance details</h2>
          <div className="profile-detail-list">
            <span><strong>Down payment</strong><b>BDT {Math.round(loan.downPayment || 0).toLocaleString("en-BD")}</b></span>
            <span><strong>Financed balance</strong><b>BDT {Math.round(Number(loan.principal || 0) - Number(loan.downPayment || 0)).toLocaleString("en-BD")}</b></span>
            <span><strong>Interest</strong><b>{loan.interestRate}% {String(loan.interestType || "").replaceAll("_", " ")}</b></span>
            <span><strong>Tenure</strong><b>{loan.tenureMonths} months</b></span>
            <span><strong>Color</strong><b>{loan.selectedColorName || "Not applicable"}</b></span>
            <span><strong>Order</strong><b>{loan.orderId?.orderNo || "Offline loan"}</b></span>
          </div>
        </section>

        <section className="panel">
          <h2>Parties</h2>
          <div className="profile-detail-list">
            <span><strong>Buyer</strong><b>{loan.buyerId?.name || "-"}</b></span>
            <span><strong>Buyer contact</strong><b>{loan.buyerId?.phone || loan.buyerId?.email || "-"}</b></span>
            <span><strong>Seller</strong><b>{loan.sellerId?.name || "-"}</b></span>
            <span><strong>Seller contact</strong><b>{loan.sellerId?.phone || loan.sellerId?.email || "-"}</b></span>
          </div>
          {loan.sellerId?._id && (
            <Link className="button secondary" to={`/stores/${loan.sellerId._id}`}>
              <Store size={16} /> View seller store
            </Link>
          )}
        </section>
      </div>

      {loan.status === "approved" && (
        <div className="notice warning">
          <CalendarClock size={18} />
          This request is approved and waiting for its Stripe down payment. The schedule and delivery processing begin after payment confirmation.
        </div>
      )}

      {agreement && (
        <section className="panel agreement-panel">
          <div className="page-title">
            <div>
              <h2><FileSignature size={19} /> Loan agreement</h2>
              <p>Agreement {agreement.agreementNo}. Download the distinct official PDF for presentation, printing, or records.</p>
            </div>
            <button className="button secondary" onClick={() => openProtectedFile(`/loans/${id}/agreement/pdf`)}>
              <Download size={16} /> Download PDF
            </button>
          </div>
          <div className="form-grid compact">
            <div>
              <strong>Buyer acceptance</strong>
              <p>{agreement.acceptedByBuyerAt ? dayjs(agreement.acceptedByBuyerAt).format("DD MMM YYYY, h:mm A") : "Pending"}</p>
            </div>
            <div>
              <strong>Seller acceptance</strong>
              <p>{agreement.acceptedBySellerAt ? dayjs(agreement.acceptedBySellerAt).format("DD MMM YYYY, h:mm A") : "Pending"}</p>
            </div>
          </div>
          <pre className="agreement-terms">{agreement.terms}</pre>
          {["buyer", "seller"].includes(user?.role) && (
            <button className="button" disabled={Boolean(acceptedForRole) || acceptAgreement.isPending} onClick={() => acceptAgreement.mutate()}>
              {acceptedForRole ? "Agreement accepted" : "Accept agreement"}
            </button>
          )}
        </section>
      )}

      <section className="panel">
        <div className="page-title">
          <div>
            <h2>Installment schedule</h2>
            <p>Principal, interest, late fee, and payment progress for every month.</p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Due date</th>
                <th>Principal</th>
                <th>Interest</th>
                <th>Late fee</th>
                <th>Total due</th>
                <th>Paid</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {schedule.length === 0 ? (
                <tr><td colSpan="8" style={{ textAlign: "center", color: "#888" }}>The schedule will be generated when this loan becomes active.</td></tr>
              ) : (
                schedule.map((row) => (
                  <tr key={row._id}>
                    <td>{row.installmentNo}</td>
                    <td>{dayjs(row.dueDate).format("DD MMM YYYY")}</td>
                    <td>BDT {Math.round(row.principalAmount || 0).toLocaleString("en-BD")}</td>
                    <td>BDT {Math.round(row.interestAmount || 0).toLocaleString("en-BD")}</td>
                    <td>BDT {Math.round(row.lateFee || 0).toLocaleString("en-BD")}</td>
                    <td>BDT {Math.round(row.amountDue || 0).toLocaleString("en-BD")}</td>
                    <td>BDT {Math.round(row.amountPaid || 0).toLocaleString("en-BD")}</td>
                    <td><StatusBadge status={row.status} /></td>
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
