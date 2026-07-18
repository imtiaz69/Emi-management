import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import {
  BadgeDollarSign,
  Bell,
  CalendarClock,
  ClipboardList,
  CreditCard,
  Heart,
  History,
  LayoutDashboard,
  ShieldCheck,
  ShoppingCart,
  Star,
  Store,
  Trash2,
  Truck,
  UserRound,
  X
} from "lucide-react";
import { api, openProtectedFile } from "../api/http";
import ProtectedDocumentViewer from "../components/ProtectedDocumentViewer.jsx";
import ProtectedImage from "../components/ProtectedImage.jsx";
import DashboardShell from "../components/DashboardShell.jsx";
import NotificationInbox from "../components/NotificationInbox.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import StatCard from "../components/StatCard.jsx";
import { KYC_DOCUMENT_TYPES, formatKycType } from "../utils/kyc.js";
import { notifyError, notifyInfo, notifySuccess, notifyWarning } from "../utils/toast.js";

const buyerTabs = [
  { key: "overview", label: "Overview", icon: LayoutDashboard, group: "Workspace" },
  { key: "notifications", label: "Notifications", icon: Bell, group: "Workspace" },
  { key: "wishlist", label: "Wishlist", icon: Heart, group: "Shopping" },
  { key: "orders", label: "Orders & delivery", icon: Truck, group: "Shopping" },
  { key: "profile", label: "Buyer profile", icon: UserRound, group: "Verification" },
  { key: "kyc", label: "KYC upload", icon: ShieldCheck, group: "Verification" },
  { key: "loans", label: "My EMI loans", icon: BadgeDollarSign, group: "Finance" },
  { key: "applications", label: "EMI applications", icon: ClipboardList, group: "Finance" },
  { key: "payments", label: "Payment history", icon: History, group: "Finance" }
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
  const [profilePhotoFile, setProfilePhotoFile] = useState(null);
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
  const [paymentModalLoanId, setPaymentModalLoanId] = useState("");
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

  const uploadProfilePhoto = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append("profilePhoto", profilePhotoFile);
      return api.post("/buyer/profile-photo", form, { headers: { "Content-Type": "multipart/form-data" } });
    },
    onSuccess: () => {
      setProfilePhotoFile(null);
      queryClient.invalidateQueries({ queryKey: ["buyer-profile"] });
      notifySuccess("Profile picture uploaded successfully.");
    },
    onError: (err) => notifyError(err, "Unable to upload profile picture.")
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

  const stripePay = useMutation({
    mutationFn: async ({ loanId, amount, allocationMode, installmentCount }) => api.post("/payments/stripe/create-checkout-session", { loanId, amount, allocationMode, installmentCount }),
    onSuccess: ({ data }) => {
      setPaymentModalLoanId("");
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
    if (loan.status === "approved") {
      return {
        loanId: loan._id,
        allocationMode: "next_due",
        amount: Number(loan.downPayment || 0)
      };
    }
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
  const paymentModalLoan = (loans.data || []).find((loan) => loan._id === paymentModalLoanId);
  const paymentModalDraft = paymentModalLoan ? paymentDrafts[paymentModalLoan._id] || { allocationMode: "next_due", installmentCount: "2", amount: "" } : null;
  const paymentModalPayload = paymentModalLoan ? buildPaymentPayload(paymentModalLoan) : null;
  const paymentModalInstallments = paymentModalLoan ? getPayableInstallments(paymentModalLoan) : [];
  const paymentModalInstallmentCount = paymentModalDraft
    ? Math.min(Math.max(Number(paymentModalDraft.installmentCount || 2), 2), Math.max(paymentModalInstallments.length, 2))
    : 2;

  function openPaymentModal(loan) {
    const allocationMode = "next_due";
    updatePaymentDraft(loan._id, {
      allocationMode,
      installmentCount: "2",
      amount: loan.status === "approved" ? String(loan.downPayment || "") : ""
    });
    setPaymentModalLoanId(loan._id);
  }

  useEffect(() => {
    if (!paymentModalLoanId) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !stripePay.isPending) setPaymentModalLoanId("");
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [paymentModalLoanId, stripePay.isPending]);

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
    <DashboardShell
      title={buyerTabs.find((tab) => tab.key === activeTab)?.label || "Buyer Dashboard"}
      description="Track purchases, verification, EMI applications, payments, and delivery."
      roleLabel="Buyer Workspace"
      tabs={buyerTabs}
      activeTab={activeTab}
      onTabChange={setActiveTab}
    >
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
                <StatCard label="Total outstanding" value={`BDT ${Math.round(summary.data?.dueAmount || 0)}`} tone="red" />
                <StatCard label="Total amount in EMI" value={`BDT ${Math.round(summary.data?.totalEmiAmount || 0)}`} tone="purple" />
                <StatCard label="Financed product amount" value={`BDT ${Math.round(summary.data?.totalFinancedAmount || 0)}`} />
                <StatCard label="Next due total" value={`BDT ${Math.round(nextDueAmount)}`} tone="purple" />
                <StatCard label="Overdues" value={summary.data?.overdueCount ?? 0} tone="red" />
                <StatCard label="EMI paid this month" value={`BDT ${Math.round(summary.data?.monthlyCollection || 0)}`} tone="green" />
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
              <div className="profile-photo-panel">
                <ProtectedImage
                  src={buyerProfile.data?.profile?.profilePhoto?.downloadUrl}
                  alt="Buyer profile"
                  className="profile-photo-preview"
                  fallback={<div className="profile-photo-preview placeholder"><UserRound size={34} /></div>}
                />
                <div className="profile-photo-controls">
                  <label>Profile picture
                    <input type="file" accept=".jpg,.jpeg,.png,.webp,.avif" onChange={(e) => setProfilePhotoFile(e.target.files?.[0] || null)} />
                  </label>
                  <button className="button secondary" onClick={() => uploadProfilePhoto.mutate()} disabled={!profilePhotoFile || uploadProfilePhoto.isPending}>
                    Upload picture
                  </button>
                  <p className="hint">This picture is visible to sellers and admins when they review your EMI trust profile.</p>
                </div>
              </div>
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
                  <select value={kycType} onChange={(e) => setKycType(e.target.value)}>
                    {KYC_DOCUMENT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                  </select>
                </label>
                <label>Documents
                  <input type="file" multiple accept=".jpg,.jpeg,.png,.webp,.avif,.pdf" onChange={(e) => setFiles(e.target.files)} />
                </label>
              </div>
              <p className="hint">You can upload more records any time. Each submission supports up to 10 files.</p>
              <button className="button" onClick={() => uploadKyc.mutate()} disabled={!files.length || uploadKyc.isPending}>Upload documents</button>
              <div className="list-stack">
                {(kyc.data || []).length === 0 ? (
                  <p className="hint">No KYC documents uploaded yet.</p>
                ) : (
                  (kyc.data || []).map((doc) => (
                    <div className="list-row" key={doc._id}>
                      <div>
                        <strong>{formatKycType(doc.type)}</strong>
                        <span>Uploaded {doc.createdAt ? dayjs(doc.createdAt).format("DD MMM YYYY") : "-"}</span>
                      </div>
                      <div className="button-row">
                        {(doc.files || []).map((file) => (
                          <ProtectedDocumentViewer key={file.downloadUrl} file={file} label={file.originalName || "Document"} />
                        ))}
                        {doc.selfie && (
                          <ProtectedDocumentViewer file={doc.selfie} label="Selfie" />
                        )}
                        <StatusBadge status={doc.status} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          )}

          {activeTab === "loans" && (
            <section className="panel">
              <div className="page-title">
                <div>
                  <h2>My EMI loans</h2>
                  <p>Approved requests become deliverable after the down payment is confirmed. Monthly EMI collection starts from the generated schedule.</p>
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Seller</th>
                      <th>Product</th>
                      <th>Total EMI</th>
                      <th>Next EMI date</th>
                      <th>Payable</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(loans.data || []).map((loan) => {
                      const nextInstallment = getPayableInstallments(loan)[0];
                      const dueState = getDueDateState(nextInstallment?.dueDate);
                      const sellerId = loan.sellerId?._id || loan.sellerId;
                      return (
                        <tr key={loan._id}>
                          <td>
                            {sellerId ? (
                              <Link className="seller-loan-link" to={`/stores/${sellerId}`} title={`Open seller ${sellerId}`}>
                                <Store size={16} />
                                <span>
                                  <strong>{loan.sellerStore?.shopName || loan.sellerId?.name || "Seller"}</strong>
                                  <small>
                                    {loan.sellerStore?.reviewCount
                                      ? <><Star size={12} /> {loan.sellerStore.averageRating} ({loan.sellerStore.reviewCount})</>
                                      : "View seller store"}
                                  </small>
                                </span>
                              </Link>
                            ) : "-"}
                          </td>
                          <td>
                            {loan.productId?._id ? <Link to={`/products/${loan.productId._id}`}>{loan.productId.name}</Link> : "Offline loan"}
                            {loan.selectedColorName && <small className="table-subtext">Color: {loan.selectedColorName}</small>}
                          </td>
                          <td>
                            <strong>BDT {Math.round(loan.totalPayable || 0).toLocaleString("en-BD")}</strong>
                            <small className="table-subtext">Principal BDT {Math.round(loan.principal || 0).toLocaleString("en-BD")}</small>
                          </td>
                          <td>
                            {nextInstallment ? (
                              <span className={`due-date-indicator ${dueState.tone}`}>
                                <CalendarClock size={15} />
                                <span>
                                  <strong>{dayjs(nextInstallment.dueDate).format("DD MMM YYYY")}</strong>
                                  <small>{dueState.label}</small>
                                </span>
                              </span>
                            ) : loan.status === "approved" ? (
                              <span className="status-note warning">Starts after down payment</span>
                            ) : (
                              <span className="status-note">No upcoming EMI</span>
                            )}
                          </td>
                          <td>
                            {loan.status === "approved" ? (
                              <>
                                <strong>Down payment: BDT {Math.round(loan.downPayment || 0).toLocaleString("en-BD")}</strong>
                                <small className="table-subtext">Required before delivery</small>
                              </>
                            ) : (
                              <>
                                <span>Next: BDT {Math.round(loan.paymentSummary?.nextDueAmount || 0).toLocaleString("en-BD")}</span><br />
                                <span>Overdue: BDT {Math.round(loan.paymentSummary?.overdueAmount || 0).toLocaleString("en-BD")}</span><br />
                                <span>Outstanding: BDT {Math.round(loan.paymentSummary?.outstandingAmount || 0).toLocaleString("en-BD")}</span>
                              </>
                            )}
                          </td>
                          <td>
                            <StatusBadge status={loan.status} />
                            {loan.status === "approved" && <small className="table-subtext">Awaiting down payment</small>}
                          </td>
                          <td className="table-action-cell">
                            {["active", "closed"].includes(loan.status) && <Link className="button tiny secondary" to={`/loans/${loan._id}`}>View details</Link>}
                            {["approved", "active"].includes(loan.status) && (
                              <button
                                className="button tiny"
                                disabled={stripePay.isPending || (loan.status === "active" && !loan.paymentSummary?.outstandingAmount)}
                                onClick={() => openPaymentModal(loan)}
                              >
                                <CreditCard size={14} /> Pay
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {(loans.data || []).length === 0 && <tr><td colSpan="7" style={{ textAlign: "center", color: "#888" }}>No EMI loans yet.</td></tr>}
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
                              <button className="button tiny" disabled={stripePayOrder.isPending} onClick={() => stripePayOrder.mutate(order._id)}>Pay</button>
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
            <NotificationInbox />
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
                          <td>
                            <button className="button tiny" onClick={() => openProtectedFile(`/payments/${payment._id}/receipt`)}>
                              Download PDF
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {paymentModalLoan && paymentModalDraft && paymentModalPayload && (
            <div
              className="modal-backdrop payment-modal-backdrop"
              role="presentation"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget && !stripePay.isPending) setPaymentModalLoanId("");
              }}
            >
              <section className="modal payment-modal" role="dialog" aria-modal="true" aria-labelledby="payment-modal-title">
                <div className="modal-heading">
                  <div>
                    <span className="modal-kicker">{paymentModalLoan.status === "approved" ? "Activate EMI purchase" : "Installment payment"}</span>
                    <h2 id="payment-modal-title">
                      {paymentModalLoan.status === "approved" ? "Pay the required down payment" : "Choose what you want to pay"}
                    </h2>
                    <p>{paymentModalLoan.productId?.name || "EMI loan"} from {paymentModalLoan.sellerStore?.shopName || paymentModalLoan.sellerId?.name || "seller"}</p>
                  </div>
                  <button
                    className="icon-button modal-close-button"
                    type="button"
                    aria-label="Close payment dialog"
                    disabled={stripePay.isPending}
                    onClick={() => setPaymentModalLoanId("")}
                  >
                    <X size={18} />
                  </button>
                </div>

                {paymentModalLoan.status === "approved" ? (
                  <div className="payment-activation-notice">
                    <CreditCard size={22} />
                    <div>
                      <strong>Down payment confirms this EMI purchase</strong>
                      <p>After Stripe confirms this payment, the product becomes ready for seller processing and your monthly schedule starts.</p>
                    </div>
                  </div>
                ) : (
                  <div className="payment-modal-fields">
                    <label>Payment option
                      <select
                        value={paymentModalDraft.allocationMode}
                        onChange={(event) => {
                          const allocationMode = event.target.value;
                          updatePaymentDraft(paymentModalLoan._id, { allocationMode, amount: "" });
                        }}
                      >
                        <option value="next_due">Next installment</option>
                        <option value="next_n" disabled={paymentModalInstallments.length < 2}>Multiple installments</option>
                        <option value="overdue" disabled={!paymentModalLoan.paymentSummary?.overdueAmount}>All overdue installments</option>
                        <option value="advance">Full outstanding balance</option>
                        <option value="custom">Custom partial amount</option>
                      </select>
                    </label>

                    {paymentModalDraft.allocationMode === "next_n" && (
                      <label>Number of installments
                        <select
                          value={paymentModalInstallmentCount}
                          onChange={(event) => updatePaymentDraft(paymentModalLoan._id, { installmentCount: event.target.value, amount: "" })}
                        >
                          {paymentModalInstallments.slice(0, 12).map((_, index) => (
                            index >= 1 ? <option key={index + 1} value={index + 1}>{index + 1} installments</option> : null
                          ))}
                        </select>
                      </label>
                    )}

                    {paymentModalDraft.allocationMode === "custom" && (
                      <label>Custom amount (BDT)
                        <input
                          type="number"
                          min="1"
                          max={paymentModalLoan.paymentSummary?.outstandingAmount || undefined}
                          value={paymentModalDraft.amount}
                          onChange={(event) => updatePaymentDraft(paymentModalLoan._id, { amount: event.target.value })}
                          placeholder="Enter an amount"
                        />
                      </label>
                    )}

                    <div className="selected-installments">
                      {(paymentModalDraft.allocationMode === "next_n"
                        ? paymentModalInstallments.slice(0, paymentModalInstallmentCount)
                        : paymentModalInstallments.slice(0, 1)
                      ).map((installment) => (
                        <div key={installment._id}>
                          <span>Installment {installment.installmentNo}</span>
                          <strong>BDT {Math.round(installment.balance || 0).toLocaleString("en-BD")}</strong>
                          <small>{dayjs(installment.dueDate).format("DD MMM YYYY")}</small>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="payment-total-row">
                  <div>
                    <span>{paymentModalLoan.status === "approved" ? "Required down payment" : "Stripe payment total"}</span>
                    <small>No extra interest or payment markup is added here.</small>
                  </div>
                  <strong>BDT {Math.round(paymentModalPayload.amount || 0).toLocaleString("en-BD")}</strong>
                </div>

                <div className="modal-actions">
                  <button className="button secondary" type="button" disabled={stripePay.isPending} onClick={() => setPaymentModalLoanId("")}>Cancel</button>
                  <button
                    className="button"
                    type="button"
                    disabled={stripePay.isPending || !paymentModalPayload.amount}
                    onClick={() => stripePay.mutate(paymentModalPayload)}
                  >
                    <CreditCard size={16} />
                    {stripePay.isPending ? "Opening Stripe..." : "Continue to pay"}
                  </button>
                </div>
                <p className="stripe-test-note">Stripe test card: 4242 4242 4242 4242, any future expiry, and any CVC.</p>
              </section>
            </div>
          )}
    </DashboardShell>
  );
}

function getDueDateState(dueDate) {
  if (!dueDate) return { tone: "safe", label: "Not scheduled" };
  const days = dayjs(dueDate).startOf("day").diff(dayjs().startOf("day"), "day");
  if (days < 0) return { tone: "urgent", label: `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue` };
  if (days <= 7) return { tone: "urgent", label: days === 0 ? "Due today" : `Due in ${days} day${days === 1 ? "" : "s"}` };
  return { tone: "safe", label: `Due in ${days} days` };
}
