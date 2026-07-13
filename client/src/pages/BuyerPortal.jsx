import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { Heart, ShoppingCart, Trash2, UserRound } from "lucide-react";
import { api } from "../api/http";
import StatusBadge from "../components/StatusBadge.jsx";
import StatCard from "../components/StatCard.jsx";
import { generateReceiptPdf } from "../utils/receipt.js";
import { notifyError, notifyInfo, notifySuccess, notifyWarning } from "../utils/toast.js";

const buyerTabs = [
  { key: "overview", label: "Overview" },
  { key: "wishlist", label: "Wishlist" },
  { key: "profile", label: "Buyer profile" },
  { key: "kyc", label: "KYC upload" },
  { key: "loans", label: "My EMI loans" },
  { key: "applications", label: "EMI applications" },
  { key: "orders", label: "Orders & delivery" },
  { key: "notifications", label: "Notifications" },
  { key: "payments", label: "Payment history" }
];

const buyerTabKeys = new Set(buyerTabs.map((tab) => tab.key));

function getInitialBuyerTab(search) {
  const tab = new URLSearchParams(search).get("tab");
  return buyerTabKeys.has(tab) ? tab : "overview";
}

export default function BuyerPortal() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const handledStripeSessionRef = useRef("");
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
  const [activeTab, setActiveTab] = useState(() => getInitialBuyerTab(location.search));
  const stripeParams = new URLSearchParams(location.search);
  const stripeStatus = stripeParams.get("stripe");
  const stripeSessionId = stripeParams.get("session_id");
  const loans = useQuery({ queryKey: ["buyer-loans"], queryFn: async () => (await api.get("/loans")).data });
  const payments = useQuery({ queryKey: ["payments"], queryFn: async () => (await api.get("/payments")).data });
  const kyc = useQuery({ queryKey: ["kyc"], queryFn: async () => (await api.get("/kyc/mine")).data });
  const buyerProfile = useQuery({ queryKey: ["buyer-profile"], queryFn: async () => (await api.get("/buyer/profile")).data });
  const applications = useQuery({ queryKey: ["emi-applications"], queryFn: async () => (await api.get("/emi-applications")).data });
  const summary = useQuery({ queryKey: ["buyer-summary"], queryFn: async () => (await api.get("/reports/summary")).data });
  const orders = useQuery({ queryKey: ["buyer-orders"], queryFn: async () => (await api.get("/orders")).data });
  const notifications = useQuery({ queryKey: ["notifications"], queryFn: async () => (await api.get("/notifications")).data });
  const wishlist = useQuery({ queryKey: ["wishlist"], queryFn: async () => (await api.get("/wishlist")).data });

  useEffect(() => {
    setActiveTab(getInitialBuyerTab(location.search));
  }, [location.search]);

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
      notifySuccess("KYC documents uploaded successfully.");
    },
    onError: (err) => notifyError(err, "Unable to upload KYC documents.")
  });

  const saveProfile = useMutation({
    mutationFn: async () => api.patch("/buyer/profile", { ...profileForm, monthlyIncome: Number(profileForm.monthlyIncome) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["buyer-profile"] });
      notifySuccess("Buyer profile saved.");
    },
    onError: (err) => {
      notifyError(err, "Unable to save buyer profile.");
    }
  });

  const addWishlistItemToCart = useMutation({
    mutationFn: async (productId) => api.post("/cart/items", { productId, quantity: 1, selectedFinanceMode: "cash" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cart"] });
      notifySuccess("Wishlist product added to cart.");
    },
    onError: (err) => notifyError(err, "Unable to add wishlist product to cart.")
  });

  const removeWishlistItem = useMutation({
    mutationFn: async (productId) => api.delete(`/wishlist/${productId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wishlist"] });
      notifySuccess("Product removed from wishlist.");
    },
    onError: (err) => notifyError(err, "Unable to remove wishlist product.")
  });

  const mockPay = useMutation({
    mutationFn: async ({ loanId, amount, allocationMode, installmentCount }) => api.post("/payments/mock-gateway", { loanId, amount, allocationMode, installmentCount }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["buyer-loans"] });
      queryClient.invalidateQueries({ queryKey: ["buyer-summary"] });
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      notifySuccess("Mock EMI payment recorded successfully.");
    },
    onError: (err) => notifyError(err, "Unable to record mock EMI payment.")
  });

  const stripePay = useMutation({
    mutationFn: async ({ loanId, amount, allocationMode, installmentCount }) => api.post("/payments/stripe/create-checkout-session", { loanId, amount, allocationMode, installmentCount }),
    onSuccess: ({ data }) => {
      notifyInfo("Redirecting to Stripe for EMI payment.");
      window.location.href = data.url;
    },
    onError: (err) => notifyError(err, "Unable to start Stripe EMI payment.")
  });
  const stripePayOrder = useMutation({
    mutationFn: async (orderId) => api.post("/payments/stripe/create-order-checkout-session", { orderId }),
    onSuccess: ({ data }) => {
      notifyInfo("Redirecting to Stripe for order payment.");
      window.location.href = data.url;
    },
    onError: (err) => notifyError(err, "Unable to start Stripe order payment.")
  });

  const confirmStripePayment = useMutation({
    mutationFn: async (sessionId) => api.post("/payments/stripe/confirm-checkout-session", { sessionId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["buyer-loans"] });
      queryClient.invalidateQueries({ queryKey: ["buyer-summary"] });
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      notifySuccess("Stripe payment recorded successfully.");
      clearStripeReturnParams();
    },
    onError: (err) => {
      notifyError(err, "Unable to record Stripe payment.");
      clearStripeReturnParams();
    }
  });

  function clearStripeReturnParams() {
    const params = new URLSearchParams(location.search);
    params.delete("stripe");
    params.delete("session_id");
    const search = params.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : "", hash: location.hash }, { replace: true });
  }

  function updatePaymentDraft(loanId, patch) {
    setPaymentDrafts((current) => ({ ...current, [loanId]: { allocationMode: "next_due", installmentCount: "2", amount: "", ...(current[loanId] || {}), ...patch } }));
  }

  function getPayableInstallments(loan) {
    return loan.paymentSummary?.payableInstallments || [];
  }

  function getNextInstallmentsAmount(loan, installmentCount) {
    const count = Math.max(Number(installmentCount || 2), 1);
    return getPayableInstallments(loan).slice(0, count).reduce((sum, row) => sum + Number(row.balance || 0), 0);
  }

  function getSuggestedAmount(loan, allocationMode, installmentCount = 2) {
    if (allocationMode === "overdue") return loan.paymentSummary?.overdueAmount || 0;
    if (allocationMode === "advance") return loan.paymentSummary?.outstandingAmount || 0;
    if (allocationMode === "next_n") return getNextInstallmentsAmount(loan, installmentCount);
    return loan.paymentSummary?.nextDueAmount || 0;
  }

  function buildPaymentPayload(loan) {
    const draft = paymentDrafts[loan._id] || {};
    const allocationMode = draft.allocationMode || "next_due";
    const installmentCount = Math.max(Number(draft.installmentCount || 2), 1);
    const amount = Number(draft.amount || getSuggestedAmount(loan, allocationMode, installmentCount));
    return {
      loanId: loan._id,
      allocationMode,
      amount,
      ...(allocationMode === "next_n" ? { installmentCount } : {})
    };
  }

  const nextDueAmount = (loans.data || []).reduce((sum, loan) => sum + Number(loan.paymentSummary?.nextDueAmount || 0), 0);

  useEffect(() => {
    const stripeReturnKey = `${stripeStatus || ""}:${stripeSessionId || ""}`;
    if (!stripeStatus || handledStripeSessionRef.current === stripeReturnKey) return;

    if (stripeStatus === "cancel") {
      handledStripeSessionRef.current = stripeReturnKey;
      notifyWarning("Stripe payment was cancelled. No EMI payment was recorded.");
      clearStripeReturnParams();
      return;
    }
    if (stripeStatus === "success" && stripeSessionId) {
      handledStripeSessionRef.current = stripeReturnKey;
      confirmStripePayment.mutate(stripeSessionId);
    }
  }, [stripeSessionId, stripeStatus]);

  return (
    <section className="seller-dashboard buyer-dashboard">
      <div className="seller-header">
        <div>
          <h1>Buyer Dashboard</h1>
          <p>Use the left sidebar to manage profile, KYC, EMI loans, orders, notifications, and payment history.</p>
        </div>
      </div>

      <div className="seller-dashboard-layout">
        <aside className="seller-sidebar buyer-sidebar">
          <div className="sidebar-brand">
            <UserRound size={20} />
            <span>Buyer Hub</span>
          </div>

          <nav className="sidebar-nav">
            {buyerTabs.map((tab) => (
              <button
                key={tab.key}
                className={`sidebar-link ${activeTab === tab.key ? "active" : ""}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </aside>

        <main className="seller-content">
          {activeTab === "overview" && (
            <>
              <div className="page-title">
                <div>
                  <h2>Overview</h2>
                  <p>Your current EMI position, payment status, and buyer readiness snapshot.</p>
                </div>
              </div>
              <div className="stats-grid">
                <StatCard label="Active EMIs" value={summary.data?.activeEmis ?? 0} />
                <StatCard label="Due amount" value={`BDT ${Math.round(summary.data?.dueAmount || 0)}`} tone="green" />
                <StatCard label="Next due total" value={`BDT ${Math.round(nextDueAmount)}`} tone="purple" />
                <StatCard label="Overdues" value={summary.data?.overdueCount ?? 0} tone="red" />
                <StatCard label="Paid this month" value={`BDT ${Math.round(summary.data?.monthlyCollection || 0)}`} tone="purple" />
              </div>

              {buyerProfile.data?.readiness && !buyerProfile.data.readiness.ready && (
                <div className="notice warning">
                  EMI requests are locked until profile and KYC are complete. Missing: {[...(buyerProfile.data.readiness.missingFields || []), buyerProfile.data.readiness.hasKyc ? null : "KYC upload"].filter(Boolean).join(", ")}.
                </div>
              )}

              <section className="panel">
                <h2>Account snapshot</h2>
                <div className="stats-grid">
                  <StatCard label="Risk score" value={`${buyerProfile.data?.profile?.riskScore ?? 0}`} />
                  <StatCard label="Risk category" value={buyerProfile.data?.profile?.riskCategory || "low"} tone="green" />
                  <StatCard label="KYC documents" value={(kyc.data || []).length} tone="purple" />
                  <StatCard label="Orders" value={(orders.data || []).length} />
                </div>
              </section>
            </>
          )}

          {activeTab === "wishlist" && (
            <section className="panel">
              <div className="page-title">
                <div>
                  <h2><Heart size={18} /> Wishlist</h2>
                  <p>Saved products you want to compare, buy later, or add to cart.</p>
                </div>
                <Link className="button secondary" to="/marketplace">Browse marketplace</Link>
              </div>

              {(wishlist.data?.products || []).length === 0 ? (
                <div className="empty-state">
                  <Heart size={36} />
                  <p>No wishlist products yet. Tap the heart icon on marketplace products to save them here.</p>
                </div>
              ) : (
                <div className="product-grid">
                  {(wishlist.data?.products || []).map((product) => (
                    <article className="product-card" key={product._id}>
                      {product.images?.[0]?.path ? (
                        <img className="product-image" src={product.images[0].path} alt={product.name} />
                      ) : (
                        <div className="product-media"><Heart size={34} /></div>
                      )}
                      <h2>{product.name}</h2>
                      <p>{product.description || "Saved product from marketplace."}</p>
                      <div className="product-meta">
                        <strong>BDT {Number(product.price || 0).toLocaleString("en-BD")}</strong>
                        <span>{product.stock || 0} in stock</span>
                      </div>
                      <div className="button-row">
                        <Link className="button" to={`/products/${product._id}`}>View</Link>
                        <button className="button secondary" disabled={addWishlistItemToCart.isPending || !product.stock} onClick={() => addWishlistItemToCart.mutate(product._id)}>
                          <ShoppingCart size={15} /> Cart
                        </button>
                        <button className="button tiny danger" disabled={removeWishlistItem.isPending} onClick={() => removeWishlistItem.mutate(product._id)}>
                          <Trash2 size={14} /> Remove
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}

          {activeTab === "profile" && (
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
          )}

          {activeTab === "kyc" && (
            <section className="panel">
              <h2>KYC upload</h2>
              <div className="form-grid compact">
                <label>Document type
                  <select value={kycType} onChange={(e) => setKycType(e.target.value)}><option value="nid">NID</option><option value="passport">Passport</option></select>
                </label>
                <label>Documents
                  <input type="file" multiple accept=".jpg,.jpeg,.png,.pdf" onChange={(e) => setFiles(e.target.files)} />
                </label>
              </div>
              <button className="button" onClick={() => uploadKyc.mutate()} disabled={!files.length || uploadKyc.isPending}>Upload documents</button>
              <div className="list-stack">
                {(kyc.data || []).length === 0 ? (
                  <p className="hint">No KYC documents uploaded yet.</p>
                ) : (
                  (kyc.data || []).map((doc) => <div className="list-row" key={doc._id}><span>{doc.type.toUpperCase()}</span><StatusBadge status={doc.status} /></div>)
                )}
              </div>
            </section>
          )}

          {activeTab === "loans" && (
            <section className="panel">
              <h2>My EMI loans</h2>
              <p className="muted">Stripe is in test mode. Use card 4242 4242 4242 4242 with any future expiry and CVC.</p>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Seller</th><th>Product</th><th>Total</th><th>Payable</th><th>Status</th><th>Actions</th></tr></thead>
                  <tbody>
                    {(loans.data || []).map((loan) => {
                      const draft = paymentDrafts[loan._id] || { allocationMode: "next_due", amount: "" };
                      const payableInstallments = getPayableInstallments(loan);
                      const installmentCount = Math.min(
                        Math.max(Number(draft.installmentCount || 2), 2),
                        Math.max(payableInstallments.length, 2)
                      );
                      const suggestedAmount = getSuggestedAmount(loan, draft.allocationMode, installmentCount);
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
                              onChange={(e) => {
                                const allocationMode = e.target.value;
                                const nextCount = allocationMode === "next_n" ? installmentCount : draft.installmentCount;
                                updatePaymentDraft(loan._id, {
                                  allocationMode,
                                  installmentCount: nextCount,
                                  amount: String(getSuggestedAmount(loan, allocationMode, nextCount) || "")
                                });
                              }}
                            >
                              <option value="next_due">Next installment</option>
                              <option value="next_n">Multiple installments</option>
                              <option value="overdue">Overdue balance</option>
                              <option value="advance">Full outstanding</option>
                              <option value="custom">Custom amount</option>
                            </select>
                            {draft.allocationMode === "next_n" && (
                              <input
                                className="mini-input"
                                type="number"
                                min="2"
                                max={Math.max(payableInstallments.length, 2)}
                                title="Number of upcoming EMI installments to pay together"
                                value={installmentCount}
                                disabled={loan.status !== "active"}
                                onChange={(e) => {
                                  const nextCount = Math.min(
                                    Math.max(Number(e.target.value || 2), 2),
                                    Math.max(payableInstallments.length, 2)
                                  );
                                  updatePaymentDraft(loan._id, {
                                    installmentCount: String(nextCount),
                                    amount: String(getSuggestedAmount(loan, "next_n", nextCount) || "")
                                  });
                                }}
                              />
                            )}
                            <input
                              className="mini-input"
                              type="number"
                              min="1"
                              placeholder={suggestedAmount ? `BDT ${Math.round(suggestedAmount)}` : "Amount"}
                              value={draft.amount}
                              disabled={loan.status !== "active"}
                              onChange={(e) => updatePaymentDraft(loan._id, { amount: e.target.value })}
                            />
                            {draft.allocationMode === "next_n" && (
                              <span className="hint">Next {installmentCount} EMIs: BDT {Math.round(suggestedAmount || 0)}</span>
                            )}
                            <button className="button tiny" disabled={loan.status !== "active" || stripePay.isPending || !paymentPayload.amount} onClick={() => stripePay.mutate(paymentPayload)}>Stripe</button>
                            <button className="button tiny ghost" disabled={loan.status !== "active" || mockPay.isPending || !paymentPayload.amount} onClick={() => mockPay.mutate(paymentPayload)}>Mock pay</button>
                          </td>
                        </tr>
                      );
                    })}
                    {(loans.data || []).length === 0 && <tr><td colSpan="6" style={{ textAlign: "center", color: "#888" }}>No EMI loans yet.</td></tr>}
                  </tbody>
                </table>
              </div>
              {stripePay.isError && <p className="form-error">{stripePay.error?.response?.data?.message || "Unable to start Stripe payment"}</p>}
              {confirmStripePayment.isError && <p className="form-error">{confirmStripePayment.error?.response?.data?.message || "Unable to record Stripe payment"}</p>}
            </section>
          )}

          {activeTab === "applications" && (
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
          )}

          {activeTab === "orders" && (
            <section className="panel">
              <h2>My orders and delivery</h2>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Order</th><th>Total</th><th>Payment</th><th>Delivery</th><th>Placed</th><th>Action</th></tr></thead>
                  <tbody>
                    {(orders.data || []).length === 0 ? (
                      <tr><td colSpan="6" style={{ textAlign: "center", color: "#888" }}>No orders yet</td></tr>
                    ) : (
                      (orders.data || []).map((order) => (
                        <tr key={order._id}>
                          <td>{order.orderNo}</td>
                          <td>BDT {order.total}</td>
                          <td><StatusBadge status={order.paymentStatus} /></td>
                          <td><StatusBadge status={order.fulfillmentStatus} /></td>
                          <td>{dayjs(order.createdAt).format("DD MMM YYYY")}</td>
                          <td className="table-action-cell">
                            <Link className="button tiny" to={`/orders/${order._id}`}>Track</Link>
                            {order.paymentMode === "cash" && order.paymentStatus === "unpaid" && (
                              <button className="button tiny" disabled={stripePayOrder.isPending} onClick={() => stripePayOrder.mutate(order._id)}>Stripe</button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {stripePayOrder.isError && <p className="form-error">{stripePayOrder.error?.response?.data?.message || "Unable to start Stripe order payment"}</p>}
            </section>
          )}

          {activeTab === "notifications" && (
            <section className="panel">
              <h2>Notifications</h2>
              <div className="list-stack">
                {(notifications.data || []).length === 0 ? (
                  <p className="hint">No notifications yet.</p>
                ) : (
                  (notifications.data || []).map((item) => (
                    <div className="list-row" key={item._id}>
                      <div><strong>{item.messageType}</strong><span>{item.message}</span></div>
                      <StatusBadge status={item.status} />
                    </div>
                  ))
                )}
              </div>
            </section>
          )}

          {activeTab === "payments" && (
            <section className="panel">
              <h2>Payment history</h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Receipt</th><th>Loan / Order</th><th>Amount</th><th>Method</th><th>Date</th><th>Action</th></tr>
                  </thead>
                  <tbody>
                    {(payments.data || []).length === 0 ? (
                      <tr><td colSpan="6" style={{ textAlign: "center", color: "#888" }}>No payments recorded yet</td></tr>
                    ) : (
                      (payments.data || []).map((payment) => (
                        <tr key={payment._id}>
                          <td>{payment.receiptNo || "-"}</td>
                          <td>{payment.loanId?._id || payment.loanId || payment.orderId?.orderNo || payment.orderId || "-"}</td>
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
          )}
        </main>
      </div>
    </section>
  );
}
