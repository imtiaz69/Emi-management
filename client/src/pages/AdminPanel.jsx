import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import {
  BadgeDollarSign,
  Bell,
  ClipboardCheck,
  LayoutDashboard,
  PackageSearch,
  RefreshCcw,
  Scale,
  ScrollText,
  ScanFace,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  Store,
  Users
} from "lucide-react";
import { api } from "../api/http";
import DashboardShell from "../components/DashboardShell.jsx";
import IdentityVerificationPanel from "../components/IdentityVerificationPanel.jsx";
import NotificationInbox from "../components/NotificationInbox.jsx";
import ProtectedDocumentViewer from "../components/ProtectedDocumentViewer.jsx";
import ProtectedImage from "../components/ProtectedImage.jsx";
import StatCard from "../components/StatCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { formatKycType } from "../utils/kyc.js";
import { notifyError, notifySuccess } from "../utils/toast.js";

const adminTabs = [
  { key: "overview", label: "Overview", icon: LayoutDashboard, group: "Workspace" },
  { key: "notifications", label: "Notifications", icon: Bell, group: "Workspace" },
  { key: "sellerApprovals", label: "Seller approvals", icon: Store, group: "Governance" },
  { key: "kycReview", label: "KYC review", icon: ShieldCheck, group: "Governance" },
  { key: "identityVerification", label: "Identity verification", icon: ScanFace, group: "Governance" },
  { key: "users", label: "Users", icon: Users, group: "Governance" },
  { key: "products", label: "Products", icon: PackageSearch, group: "Commerce" },
  { key: "orders", label: "Orders", icon: ShoppingCart, group: "Commerce" },
  { key: "portfolio", label: "EMI portfolio", icon: BadgeDollarSign, group: "Finance" },
  { key: "disputes", label: "Disputes & returns", icon: Scale, group: "Finance" },
  { key: "settings", label: "System settings", icon: Settings2, group: "System" },
  { key: "audit", label: "Audit trail", icon: ScrollText, group: "System" }
];

const adminTabKeys = new Set(adminTabs.map((tab) => tab.key));

function getInitialAdminTab(search) {
  const tab = new URLSearchParams(search).get("tab");
  return adminTabKeys.has(tab) ? tab : "overview";
}

export default function AdminPanel() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState(() => getInitialAdminTab(location.search));
  const [sellerReason, setSellerReason] = useState("Incomplete business information");
  const [settingsForm, setSettingsForm] = useState(null);
  const overview = useQuery({ queryKey: ["admin-overview"], queryFn: async () => (await api.get("/admin/overview")).data });
  const pending = useQuery({ queryKey: ["pending-sellers"], queryFn: async () => (await api.get("/admin/sellers/pending")).data });
  const pendingKyc = useQuery({ queryKey: ["kyc-pending"], queryFn: async () => (await api.get("/kyc/pending")).data });
  const users = useQuery({ queryKey: ["admin-users"], queryFn: async () => (await api.get("/admin/users")).data });
  const audit = useQuery({ queryKey: ["audit"], queryFn: async () => (await api.get("/admin/audit")).data });
  const adminProducts = useQuery({ queryKey: ["admin-products"], queryFn: async () => (await api.get("/admin/products")).data });
  const adminOrders = useQuery({ queryKey: ["admin-orders"], queryFn: async () => (await api.get("/admin/orders")).data });
  const portfolio = useQuery({ queryKey: ["admin-portfolio"], queryFn: async () => (await api.get("/admin/portfolio")).data });
  const disputes = useQuery({ queryKey: ["admin-disputes"], queryFn: async () => (await api.get("/admin/disputes")).data });
  const returns = useQuery({ queryKey: ["admin-returns"], queryFn: async () => (await api.get("/admin/returns")).data });
  const settings = useQuery({ queryKey: ["admin-settings"], queryFn: async () => (await api.get("/admin/settings")).data });

  useEffect(() => {
    setActiveTab(getInitialAdminTab(location.search));
  }, [location.search]);

  useEffect(() => {
    if (settings.data) setSettingsForm(settings.data);
  }, [settings.data]);

  const approve = useMutation({
    mutationFn: async (id) => api.patch(`/admin/sellers/${id}/approve`),
    onSuccess: () => {
      refresh();
      notifySuccess("Seller approved successfully.");
    },
    onError: (err) => notifyError(err, "Unable to approve seller.")
  });
  const reject = useMutation({
    mutationFn: async (id) => api.patch(`/admin/sellers/${id}/reject`, { reason: sellerReason }),
    onSuccess: () => {
      refresh();
      notifySuccess("Seller rejected successfully.");
    },
    onError: (err) => notifyError(err, "Unable to reject seller.")
  });
  const needsInfo = useMutation({
    mutationFn: async (id) => api.patch(`/admin/sellers/${id}/needs-info`, { reason: sellerReason }),
    onSuccess: () => {
      refresh();
      notifySuccess("Seller marked as needs information.");
    },
    onError: (err) => notifyError(err, "Unable to update seller status.")
  });

  const reviewKyc = useMutation({
    mutationFn: async ({ id, status, rejectionReason }) => api.patch(`/kyc/${id}/review`, { status, rejectionReason }),
    onSuccess: () => {
      refresh();
      notifySuccess("KYC review submitted.");
    },
    onError: (err) => notifyError(err, "Unable to review KYC.")
  });
  const moderateProduct = useMutation({
    mutationFn: async ({ id, payload }) => api.patch(`/admin/products/${id}/moderate`, payload),
    onSuccess: () => {
      refresh();
      notifySuccess("Product moderation updated.");
    },
    onError: (err) => notifyError(err, "Unable to moderate product.")
  });
  const suspendUser = useMutation({
    mutationFn: async (id) => api.patch(`/admin/users/${id}/suspend`, { reason: "Admin status action" }),
    onSuccess: () => {
      refresh();
      notifySuccess("User suspended successfully.");
    },
    onError: (err) => notifyError(err, "Unable to suspend user.")
  });
  const reactivateUser = useMutation({
    mutationFn: async (id) => api.patch(`/admin/users/${id}/reactivate`),
    onSuccess: () => {
      refresh();
      notifySuccess("User reactivated successfully.");
    },
    onError: (err) => notifyError(err, "Unable to reactivate user.")
  });
  const saveSettings = useMutation({
    mutationFn: async () => api.patch("/admin/settings", settingsForm),
    onSuccess: () => {
      refresh();
      notifySuccess("Platform settings saved.");
    },
    onError: (err) => notifyError(err, "Unable to save platform settings.")
  });

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["pending-sellers"] });
    queryClient.invalidateQueries({ queryKey: ["kyc-pending"] });
    queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    queryClient.invalidateQueries({ queryKey: ["audit"] });
    queryClient.invalidateQueries({ queryKey: ["admin-overview"] });
    queryClient.invalidateQueries({ queryKey: ["admin-products"] });
    queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
    queryClient.invalidateQueries({ queryKey: ["admin-portfolio"] });
    queryClient.invalidateQueries({ queryKey: ["admin-disputes"] });
    queryClient.invalidateQueries({ queryKey: ["admin-returns"] });
    queryClient.invalidateQueries({ queryKey: ["admin-settings"] });
  }

  return (
    <DashboardShell
      title={adminTabs.find((tab) => tab.key === activeTab)?.label || "Admin Panel"}
      description="Review governance, lending operations, commerce activity, and system accountability."
      roleLabel="Admin Workspace"
      tabs={adminTabs}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      headerActions={<button className="button secondary" type="button" onClick={refresh}><RefreshCcw size={16} /> Refresh</button>}
    >
      {activeTab === "overview" && (
        <>
          <div className="stats-grid">
            <StatCard label="Users" value={overview.data?.users ?? 0} />
            <StatCard label="Pending sellers" value={overview.data?.sellersPending ?? 0} tone="purple" />
            <StatCard label="Pending products" value={overview.data?.productsPending ?? 0} />
            <StatCard label="Active loans" value={overview.data?.activeLoans ?? 0} tone="green" />
            <StatCard label="Orders" value={overview.data?.orders ?? 0} tone="green" />
            <StatCard label="Open disputes" value={overview.data?.disputes ?? 0} tone="red" />
          </div>
          <div className="work-grid">
            <section className="panel">
              <h2><ClipboardCheck size={18} /> Operational attention</h2>
              <div className="list-stack">
                <div className="list-row"><div><strong>Seller registrations</strong><span>Businesses waiting for an admin decision</span></div><span className="badge pending">{pending.data?.length || 0}</span></div>
                <div className="list-row"><div><strong>KYC documents</strong><span>Buyer verification files waiting for review</span></div><span className="badge pending">{pendingKyc.data?.length || 0}</span></div>
                <div className="list-row"><div><strong>Product moderation</strong><span>Products currently awaiting platform approval</span></div><span className="badge pending">{overview.data?.productsPending ?? 0}</span></div>
              </div>
            </section>
            <section className="panel">
              <h2>Recent accountability activity</h2>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Time</th><th>Actor</th><th>Action</th></tr></thead>
                  <tbody>{(audit.data || []).slice(0, 6).map((log) => <tr key={log._id}><td>{dayjs(log.createdAt).format("DD MMM HH:mm")}</td><td>{log.actorId?.name || "System"}</td><td>{log.action}</td></tr>)}</tbody>
                </table>
              </div>
            </section>
          </div>
        </>
      )}

      {activeTab === "sellerApprovals" && (
        <section className="panel">
          <h2>Pending seller registrations</h2>
          <label>Decision reason
            <input value={sellerReason} onChange={(e) => setSellerReason(e.target.value)} />
          </label>
          <div className="list-stack">
            {(pending.data || []).map((seller) => (
              <div className="list-row" key={seller._id}>
                <div><strong>{seller.shopName}</strong><span>{seller.userId?.email} | {seller.address} | Trade license: {seller.tradeLicenseNo || "-"}</span></div>
                <div className="button-row">
                  <button className="button tiny" onClick={() => approve.mutate(seller._id)}>Approve</button>
                  <button className="button tiny ghost" onClick={() => needsInfo.mutate(seller._id)}>Needs info</button>
                  <button className="button tiny danger" onClick={() => reject.mutate(seller._id)}>Reject</button>
                </div>
              </div>
            ))}
            {pending.data?.length === 0 && <p className="hint">No pending sellers.</p>}
          </div>
        </section>
      )}

      {activeTab === "kycReview" && (
        <section className="panel">
          <h2>KYC Review</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Buyer</th><th>Type</th><th>Documents</th><th>Status</th><th>Reason</th><th>Action</th></tr></thead>
              <tbody>
                {(pendingKyc.data || []).map((doc) => (
                  <tr key={doc._id}>
                    <td>
                      <div className="identity-cell">
                        <ProtectedImage
                          src={doc.buyerProfile?.profilePhoto?.downloadUrl}
                          alt={doc.userId?.name || "Buyer"}
                          className="avatar-image"
                          fallback={<div className="avatar-placeholder">{doc.userId?.name?.slice(0, 1) || "B"}</div>}
                        />
                        <div><strong>{doc.userId?.name}</strong><br />{doc.userId?.email}</div>
                      </div>
                    </td>
                    <td>{formatKycType(doc.type)}</td>
                    <td>
                      {(doc.files || []).map((file) => (
                        <div key={file.filename || file.downloadUrl}>
                          <ProtectedDocumentViewer file={file} label={file.originalName || formatKycType(doc.type)} />
                        </div>
                      ))}
                      {doc.selfie && <div><ProtectedDocumentViewer file={doc.selfie} label="Selfie" /></div>}
                    </td>
                    <td><StatusBadge status={doc.status} /></td>
                    <td>{doc.rejectionReason || "-"}</td>
                    <td className="button-row">
                      <button className="button tiny" onClick={() => reviewKyc.mutate({ id: doc._id, status: "approved" })}>Approve</button>
                      <button className="button tiny danger" onClick={() => reviewKyc.mutate({ id: doc._id, status: "rejected", rejectionReason: "Invalid document" })}>Reject</button>
                    </td>
                  </tr>
                ))}
                {pendingKyc.data?.length === 0 && <tr><td colSpan="6" style={{ textAlign: "center", color: "#888" }}>No KYC documents pending review.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activeTab === "users" && (
        <section className="panel">
          <h2>Users</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Joined</th><th>Action</th></tr></thead>
              <tbody>{(users.data || []).map((user) => <tr key={user._id}><td>{user.name}<br />{user.email}</td><td>{user.role}</td><td><StatusBadge status={user.status} /></td><td>{dayjs(user.createdAt).format("DD MMM YYYY")}</td><td className="table-action-cell"><button className="button tiny danger" disabled={user.status === "suspended"} onClick={() => suspendUser.mutate(user._id)}>Suspend</button><button className="button tiny" onClick={() => reactivateUser.mutate(user._id)}>Reactivate</button></td></tr>)}</tbody>
            </table>
          </div>
        </section>
      )}

      {activeTab === "products" && (
        <section className="panel">
          <h2>Product moderation</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Product</th><th>Seller</th><th>Price</th><th>Approval</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>{(adminProducts.data || []).slice(0, 20).map((product) => <tr key={product._id}><td>{product.name}</td><td>{product.sellerId?.name}</td><td>BDT {product.price}</td><td><StatusBadge status={product.approvalStatus} /></td><td><StatusBadge status={product.status} /></td><td className="table-action-cell"><button className="button tiny" onClick={() => moderateProduct.mutate({ id: product._id, payload: { approvalStatus: "approved", status: "active" } })}>Approve</button><button className="button tiny danger" onClick={() => moderateProduct.mutate({ id: product._id, payload: { approvalStatus: "rejected", status: "inactive" } })}>Reject</button></td></tr>)}</tbody>
            </table>
          </div>
        </section>
      )}

      {activeTab === "orders" && (
        <section className="panel">
          <h2>Orders overview</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Order</th><th>Buyer</th><th>Total</th><th>Payment</th><th>Fulfillment</th></tr></thead>
              <tbody>{(adminOrders.data || []).slice(0, 20).map((order) => <tr key={order._id}><td>{order.orderNo}</td><td>{order.buyerId?.name}</td><td>BDT {order.total}</td><td><StatusBadge status={order.paymentStatus} /></td><td><StatusBadge status={order.fulfillmentStatus} /></td></tr>)}</tbody>
            </table>
          </div>
        </section>
      )}

      {activeTab === "portfolio" && (
        <section className="panel">
          <h2>EMI portfolio</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Status</th><th>Loans</th><th>Principal</th><th>Total payable</th></tr></thead>
              <tbody>{(portfolio.data || []).map((row) => <tr key={row.status}><td><StatusBadge status={row.status} /></td><td>{row.count}</td><td>BDT {Math.round(row.principal || 0)}</td><td>BDT {Math.round(row.totalPayable || 0)}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      )}

      {activeTab === "disputes" && (
        <section className="panel">
          <h2>Disputes and returns</h2>
          <div className="list-stack">
            {(disputes.data || []).slice(0, 5).map((item) => <div className="list-row" key={item._id}><div><strong>{item.subject}</strong><span>{item.raisedBy?.email}</span></div><StatusBadge status={item.status} /></div>)}
            {(returns.data || []).slice(0, 5).map((item) => <div className="list-row" key={item._id}><div><strong>Return request</strong><span>{item.buyerId?.email} | {item.reason}</span></div><StatusBadge status={item.status} /></div>)}
            {(disputes.data || []).length === 0 && (returns.data || []).length === 0 && <p className="hint">No disputes or returns require review.</p>}
          </div>
        </section>
      )}

      {activeTab === "settings" && settingsForm && (
        <section className="panel">
          <h2>System settings</h2>
          <div className="form-grid compact">
            <label>Min tenure
              <input type="number" value={settingsForm.allowedTenureMin} onChange={(e) => setSettingsForm({ ...settingsForm, allowedTenureMin: Number(e.target.value) })} />
            </label>
            <label>Max tenure
              <input type="number" value={settingsForm.allowedTenureMax} onChange={(e) => setSettingsForm({ ...settingsForm, allowedTenureMax: Number(e.target.value) })} />
            </label>
            <label>Max interest rate
              <input type="number" value={settingsForm.maxInterestRate} onChange={(e) => setSettingsForm({ ...settingsForm, maxInterestRate: Number(e.target.value) })} />
            </label>
            <label>Default late fee type
              <select value={settingsForm.defaultLateFeeType} onChange={(e) => setSettingsForm({ ...settingsForm, defaultLateFeeType: e.target.value })}>
                <option value="none">None</option>
                <option value="fixed">Fixed</option>
                <option value="daily">Daily</option>
                <option value="percentage">Percentage</option>
              </select>
            </label>
            <label>Default late fee value
              <input type="number" value={settingsForm.defaultLateFeeValue} onChange={(e) => setSettingsForm({ ...settingsForm, defaultLateFeeValue: Number(e.target.value) })} />
            </label>
            <label className="inline-check"><input type="checkbox" checked={settingsForm.stripeTestMode} onChange={(e) => setSettingsForm({ ...settingsForm, stripeTestMode: e.target.checked })} /> Stripe test mode</label>
            <label className="inline-check"><input type="checkbox" checked={settingsForm.notificationEmailEnabled} onChange={(e) => setSettingsForm({ ...settingsForm, notificationEmailEnabled: e.target.checked })} /> Email notifications</label>
            <label className="inline-check"><input type="checkbox" checked={settingsForm.notificationSmsEnabled} onChange={(e) => setSettingsForm({ ...settingsForm, notificationSmsEnabled: e.target.checked })} /> SMS notifications</label>
          </div>
          <button className="button" onClick={() => saveSettings.mutate()} disabled={saveSettings.isPending}>Save settings</button>
        </section>
      )}

      {activeTab === "audit" && (
        <section className="panel">
          <h2>Audit trail</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Entity</th></tr></thead>
              <tbody>{(audit.data || []).map((log) => <tr key={log._id}><td>{dayjs(log.createdAt).format("DD MMM HH:mm")}</td><td>{log.actorId?.name || "System"}</td><td>{log.action}</td><td>{log.entityType}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      )}

      {activeTab === "notifications" && <NotificationInbox />}
      {activeTab === "identityVerification" && <IdentityVerificationPanel />}
    </DashboardShell>
  );
}
