import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, BriefcaseBusiness, CalendarClock, CreditCard, FileCheck2, Mail, MapPin, Phone, ShieldAlert, UserRound } from "lucide-react";
import dayjs from "dayjs";
import { api } from "../api/http";
import ProtectedDocumentViewer from "../components/ProtectedDocumentViewer.jsx";
import ProtectedImage from "../components/ProtectedImage.jsx";
import StatCard from "../components/StatCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { formatKycType } from "../utils/kyc.js";

export default function BuyerTrustProfile() {
  const { buyerId } = useParams();
  const trustQuery = useQuery({
    queryKey: ["buyer-trust-profile", buyerId],
    queryFn: async () => (await api.get(`/profiles/buyers/${buyerId}/trust`)).data
  });

  if (trustQuery.isLoading) return <section className="dashboard"><div className="panel">Loading buyer profile...</div></section>;
  if (trustQuery.isError || !trustQuery.data) {
    return (
      <section className="dashboard">
        <div className="panel empty-state">
          <ShieldAlert size={42} />
          <div>
            <h1>Buyer profile unavailable</h1>
            <p>You can only view buyer trust profiles connected to your shop.</p>
          </div>
        </div>
      </section>
    );
  }

  const data = trustQuery.data;
  const buyer = data.buyer || {};
  const profile = data.profile || {};
  const stats = data.stats || {};
  const kyc = data.kyc;
  const kycDocuments = data.kycDocuments || [];
  const nextDue = stats.nextDue;

  return (
    <section className="dashboard profile-page">
      <section className="profile-hero trust-hero">
        <ProtectedImage
          src={profile.profilePhoto?.downloadUrl}
          alt={buyer.name || "Buyer profile"}
          className="profile-hero-photo"
          fallback={<div className="profile-hero-icon"><UserRound size={36} /></div>}
        />
        <div className="profile-hero-content">
          <span className={`badge ${profile.riskCategory || "pending"}`}>
            <ShieldAlert size={14} /> {profile.riskCategory || "Risk pending"}
          </span>
          <h1>{buyer.name || "Buyer profile"}</h1>
          <p>Seller trust view with buyer identity, KYC status, EMI history, overdue exposure, and recent payment behavior.</p>
          <div className="profile-meta-list">
            {buyer.phone && <span><Phone size={15} /> {buyer.phone}</span>}
            {buyer.email && <span><Mail size={15} /> {buyer.email}</span>}
            {profile.address && <span><MapPin size={15} /> {profile.address}</span>}
            <span><BadgeCheck size={15} /> {buyer.isVerified ? "Verified account" : "Account not verified"}</span>
          </div>
        </div>
      </section>

      <div className="stats-grid">
        <StatCard label="Risk score" value={Number(profile.riskScore || 0).toFixed(2)} tone={riskTone(profile.riskCategory)} />
        <StatCard label="Outstanding" value={formatBDT(stats.outstandingAmount)} tone="red" />
        <StatCard label="Overdue amount" value={formatBDT(stats.overdueAmount)} tone="red" />
        <StatCard label="Paid to shop" value={formatBDT(stats.paidAmount)} tone="green" />
        <StatCard label="Active loans" value={stats.activeLoans || 0} tone="purple" />
        <StatCard label="Orders" value={stats.orderCount || 0} />
      </div>

      <div className="trust-grid">
        <section className="panel">
          <h2><UserRound size={18} /> Buyer information</h2>
          <div className="profile-detail-list">
            <span><strong>Status</strong><StatusBadge status={buyer.status} /></span>
            <span><strong>NID</strong>{profile.nidMasked || "Not provided"}</span>
            <span><strong>Occupation</strong>{profile.occupation || "Not provided"}</span>
            <span><strong>Employment</strong>{profile.employmentType || "Not provided"}</span>
            <span><strong>Monthly income</strong>{formatBDT(profile.monthlyIncome)}</span>
            <span><strong>Emergency contact</strong>{[profile.emergencyContactName, profile.emergencyContactPhone].filter(Boolean).join(" - ") || "Not provided"}</span>
            <span><strong>Joined</strong>{buyer.createdAt ? dayjs(buyer.createdAt).format("DD MMM YYYY") : "-"}</span>
            <span><strong>Last login</strong>{buyer.lastLoginAt ? dayjs(buyer.lastLoginAt).format("DD MMM YYYY, h:mm A") : "-"}</span>
          </div>
        </section>

        <section className="panel">
          <h2><FileCheck2 size={18} /> KYC and next due</h2>
          <div className="profile-detail-list">
            <span><strong>KYC status</strong>{kyc ? <StatusBadge status={kyc.status} /> : "No KYC submitted"}</span>
            <span><strong>Latest document</strong>{kyc?.type ? formatKycType(kyc.type) : "-"}</span>
            <span><strong>Uploaded</strong>{kyc?.uploadedAt ? dayjs(kyc.uploadedAt).format("DD MMM YYYY") : "-"}</span>
            <span><strong>Reviewed</strong>{kyc?.reviewedAt ? dayjs(kyc.reviewedAt).format("DD MMM YYYY") : "-"}</span>
            <span><strong>Next due</strong>{nextDue ? `${formatBDT(scheduleBalance(nextDue))} on ${dayjs(nextDue.dueDate).format("DD MMM YYYY")}` : "No open EMI due"}</span>
            <span><strong>Overdue EMI</strong>{stats.overdueInstallments || 0} installment{stats.overdueInstallments === 1 ? "" : "s"}</span>
          </div>
        </section>
      </div>

      <section className="panel">
        <h2><FileCheck2 size={18} /> Submitted buyer documents</h2>
        {kycDocuments.length === 0 ? (
          <p className="hint">No KYC documents submitted yet.</p>
        ) : (
          <div className="document-grid">
            {kycDocuments.map((doc) => (
              <article className="document-card" key={doc._id}>
                <div className="document-card-heading">
                  <strong>{formatKycType(doc.type)}</strong>
                  <StatusBadge status={doc.status} />
                </div>
                <p className="hint">Uploaded {doc.uploadedAt ? dayjs(doc.uploadedAt).format("DD MMM YYYY") : "-"}</p>
                <div className="button-row">
                  {(doc.files || []).map((file) => (
                    <ProtectedDocumentViewer key={file.downloadUrl} file={file} label={file.originalName || "Document"} />
                  ))}
                  {doc.selfie && (
                    <ProtectedDocumentViewer file={doc.selfie} label="Selfie" />
                  )}
                </div>
                {doc.rejectionReason && <p className="hint">Reason: {doc.rejectionReason}</p>}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <h2><CreditCard size={18} /> EMI relationship</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Product</th><th>Principal</th><th>Total payable</th><th>Tenure</th><th>Status</th><th>Created</th></tr></thead>
            <tbody>
              {(data.loans || []).length === 0 ? (
                <tr><td colSpan="6" style={{ textAlign: "center", color: "#888" }}>No EMI history with this shop.</td></tr>
              ) : (
                data.loans.map((loan) => (
                  <tr key={loan._id}>
                    <td>{loan.productId?.name || "Offline/custom loan"}</td>
                    <td>{formatBDT(loan.principal)}</td>
                    <td>{formatBDT(loan.totalPayable)}</td>
                    <td>{loan.tenureMonths} months</td>
                    <td><StatusBadge status={loan.status} /></td>
                    <td>{dayjs(loan.createdAt).format("DD MMM YYYY")}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="trust-grid">
        <section className="panel">
          <h2><CalendarClock size={18} /> Recent payments</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Receipt</th><th>Reference</th><th>Method</th><th>Amount</th><th>Date</th></tr></thead>
              <tbody>
                {(data.payments || []).length === 0 ? (
                  <tr><td colSpan="5" style={{ textAlign: "center", color: "#888" }}>No payments recorded yet.</td></tr>
                ) : (
                  data.payments.map((payment) => (
                    <tr key={payment._id}>
                      <td>{payment.receiptNo || "-"}</td>
                      <td>{payment.orderId?.orderNo || payment.loanId?._id || "-"}</td>
                      <td>{payment.method}</td>
                      <td>{formatBDT(payment.amount)}</td>
                      <td>{dayjs(payment.paymentDate).format("DD MMM YYYY")}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <h2><BriefcaseBusiness size={18} /> Related orders</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Order</th><th>Total</th><th>Payment</th><th>Fulfillment</th><th>Date</th></tr></thead>
              <tbody>
                {(data.orders || []).length === 0 ? (
                  <tr><td colSpan="5" style={{ textAlign: "center", color: "#888" }}>No orders found.</td></tr>
                ) : (
                  data.orders.map((order) => (
                    <tr key={order._id}>
                      <td><Link to={`/orders/${order._id}`}>{order.orderNo}</Link></td>
                      <td>{formatBDT(order.total)}</td>
                      <td><StatusBadge status={order.paymentStatus} /></td>
                      <td><StatusBadge status={order.fulfillmentStatus} /></td>
                      <td>{dayjs(order.createdAt).format("DD MMM YYYY")}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </section>
  );
}

function formatBDT(value) {
  return `BDT ${Math.round(Number(value || 0)).toLocaleString("en-BD")}`;
}

function scheduleBalance(schedule) {
  return Math.max(Number(schedule.amountDue || 0) + Number(schedule.lateFee || 0) - Number(schedule.amountPaid || 0), 0);
}

function riskTone(category) {
  if (["high", "critical"].includes(category)) return "red";
  if (category === "medium") return "purple";
  return "green";
}
