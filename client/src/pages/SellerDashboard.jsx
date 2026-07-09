import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, CheckCircle2, Eye, Package, RefreshCcw, XCircle } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import dayjs from "dayjs";
import { api, openProtectedFile } from "../api/http";
import StatCard from "../components/StatCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { generateReceiptPdf } from "../utils/receipt.js";

const tabs = [
  { key: "overview", label: "Overview" },
  { key: "onlineRequests", label: "Online EMI requests" },
  { key: "createLoan", label: "Create offline loan" },
  { key: "recordPayment", label: "Record payment" },
  { key: "addProduct", label: "Add products" },
  { key: "myProducts", label: "My products" },
  { key: "activeLoans", label: "Active EMI loans" },
  { key: "paymentHistory", label: "Payment history" },
  { key: "kycRequests", label: "KYC requests" }
];

function SearchableSelect({ label, value, onChange, options, placeholder, searchPlaceholder, getOptionLabel, getOptionValue, onValueChange }) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredOptions = options.filter((option) => getOptionLabel(option).toLowerCase().includes(normalizedQuery));

  function handleChange(nextValue) {
    onChange(nextValue);
    onValueChange?.(nextValue);
  }

  return (
    <label className="searchable-select">{label}
      <input
        className="choice-search"
        placeholder={searchPlaceholder || `Search ${label.toLowerCase()}`}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <select value={value} onChange={(event) => handleChange(event.target.value)}>
        <option value="">{placeholder}</option>
        {filteredOptions.map((option) => (
          <option key={getOptionValue(option)} value={getOptionValue(option)}>
            {getOptionLabel(option)}
          </option>
        ))}
      </select>
      {normalizedQuery && filteredOptions.length === 0 && <span className="field-note">No matching option found.</span>}
    </label>
  );
}

export default function SellerDashboard() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("overview");
  const [productForm, setProductForm] = useState({ name: "", category: "Mobile", price: "", stock: "", description: "", emiAvailable: true });
  const [productImages, setProductImages] = useState([]);
  const [loanForm, setLoanForm] = useState({ buyerId: "", productId: "", principal: "", downPayment: "0", interestRate: "12", interestType: "flat", tenureMonths: "6", lateFeeType: "daily", lateFeeValue: "20" });
  const [schedulePreview, setSchedulePreview] = useState(null);
  const [paymentForm, setPaymentForm] = useState({ loanId: "", amount: "", method: "cash", allocationMode: "next_due", notes: "" });
  const [kycRejectReason, setKycRejectReason] = useState("");
  const [loanDetailsModal, setLoanDetailsModal] = useState(null);

  const summary = useQuery({ queryKey: ["summary"], queryFn: async () => (await api.get("/reports/summary")).data });
  const products = useQuery({ queryKey: ["seller-products"], queryFn: async () => (await api.get("/products/mine")).data });
  const loans = useQuery({ queryKey: ["loans"], queryFn: async () => (await api.get("/loans")).data });
  const payments = useQuery({ queryKey: ["payments"], queryFn: async () => (await api.get("/payments")).data });
  const buyers = useQuery({ queryKey: ["buyers-for-seller"], queryFn: async () => (await api.get("/users", { params: { role: "buyer", status: "active" } })).data });
  const pendingKyc = useQuery({ queryKey: ["pending-kyc"], queryFn: async () => (await api.get("/kyc/pending-for-seller")).data });
  const applications = useQuery({ queryKey: ["emi-applications"], queryFn: async () => (await api.get("/emi-applications")).data });
  const overdue = useQuery({ queryKey: ["overdue"], queryFn: async () => (await api.get("/reports/overdue")).data });
  const collections = useQuery({ queryKey: ["collections"], queryFn: async () => (await api.get("/reports/collections")).data });

  const activeLoans = (loans.data || []).filter((loan) => loan.status === "active");
  const activeProducts = useMemo(() => (products.data || []).filter((product) => product.status === "active"), [products.data]);
  const requestedLoans = (loans.data || []).filter((loan) => loan.status === "requested");
  const requestedCount = requestedLoans.length;
  const applicationByLoanId = useMemo(() => {
    const map = new Map();
    (applications.data || []).forEach((application) => {
      const loanId = application.loanId?._id || application.loanId;
      if (loanId) map.set(loanId, application);
    });
    return map;
  }, [applications.data]);
  const overviewChartData = [
    { label: "Total sales", amount: summary.data?.totalSales || 0 },
    { label: "Collection", amount: summary.data?.totalCollection || 0 },
    { label: "Overdue", amount: summary.data?.totalOverdueAmount || 0 }
  ];
  const productImagePreviews = useMemo(() => productImages.map((file) => ({ name: file.name, url: URL.createObjectURL(file) })), [productImages]);
  const kycByBuyerId = useMemo(() => {
    const map = new Map();
    (pendingKyc.data || []).forEach((doc) => {
      if (doc.userId?._id) map.set(doc.userId._id, doc);
    });
    return map;
  }, [pendingKyc.data]);

  const createProduct = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      formData.append("name", productForm.name);
      formData.append("category", productForm.category);
      formData.append("price", productForm.price);
      formData.append("stock", productForm.stock);
      formData.append("description", productForm.description);
      formData.append("emiAvailable", productForm.emiAvailable ? "true" : "false");
      productImages.slice(0, 5).forEach((file) => formData.append("images", file));
      return api.post("/products", formData);
    },
    onSuccess: () => {
      setProductForm({ name: "", category: "Mobile", price: "", stock: "", description: "", emiAvailable: true });
      setProductImages([]);
      queryClient.invalidateQueries({ queryKey: ["seller-products"] });
      queryClient.invalidateQueries({ queryKey: ["marketplace"] });
      queryClient.invalidateQueries({ queryKey: ["summary"] });
      alert("Product added successfully.");
    },
    onError: (err) => {
      alert(err.response?.data?.message || "Failed to add product.");
    }
  });

  const createLoan = useMutation({
    mutationFn: async () => api.post("/loans/offline", buildLoanPayload()),
    onSuccess: () => {
      setLoanForm({ buyerId: "", productId: "", principal: "", downPayment: "0", interestRate: "12", interestType: "flat", tenureMonths: "6", lateFeeType: "daily", lateFeeValue: "20" });
      setSchedulePreview(null);
      refreshData();
      alert("Offline loan created successfully.");
    },
    onError: (err) => {
      alert(err.response?.data?.message || "Failed to create offline loan.");
    }
  });

  const previewSchedule = useMutation({
    mutationFn: async () => api.post("/loans/preview", buildLoanPayload()),
    onSuccess: ({ data }) => setSchedulePreview(data),
    onError: (err) => {
      setSchedulePreview(null);
      alert(err.response?.data?.message || "Failed to preview EMI schedule.");
    }
  });

  const recordPayment = useMutation({
    mutationFn: async () => api.post("/payments/manual", { ...paymentForm, amount: Number(paymentForm.amount) }),
    onSuccess: () => {
      setPaymentForm({ loanId: "", amount: "", method: "cash", allocationMode: "next_due", notes: "" });
      refreshData();
      alert("Payment recorded successfully.");
    },
    onError: (err) => {
      alert(err.response?.data?.message || "Failed to record payment.");
    }
  });

  const approveKyc = useMutation({
    mutationFn: async (kycId) => api.patch(`/kyc/${kycId}/review-seller`, { status: "approved" }),
    onSuccess: () => {
      refreshData();
      alert("KYC approved successfully.");
    },
    onError: (err) => {
      alert(err.response?.data?.message || "Failed to approve KYC.");
    }
  });

  const rejectKyc = useMutation({
    mutationFn: async ({ kycId, reason }) => api.patch(`/kyc/${kycId}/review-seller`, { status: "rejected", rejectionReason: reason }),
    onSuccess: () => {
      setKycRejectReason("");
      refreshData();
      alert("KYC rejected successfully.");
    },
    onError: (err) => {
      alert(err.response?.data?.message || "Failed to reject KYC.");
    }
  });

  const approveOnlineRequest = useMutation({
    mutationFn: async (loanId) => api.patch(`/loans/${loanId}/approve`),
    onSuccess: () => {
      refreshData();
      alert("Online EMI request approved and EMI schedule generated.");
    },
    onError: (err) => {
      alert(err.response?.data?.message || "Failed to approve EMI request.");
    }
  });

  const rejectOnlineRequest = useMutation({
    mutationFn: async ({ loanId, reason }) => api.patch(`/loans/${loanId}/reject`, { reason }),
    onSuccess: () => {
      refreshData();
      alert("Online EMI request rejected.");
    },
    onError: (err) => {
      alert(err.response?.data?.message || "Failed to reject EMI request.");
    }
  });

  async function refreshData() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["summary"] }),
      queryClient.invalidateQueries({ queryKey: ["seller-products"] }),
      queryClient.invalidateQueries({ queryKey: ["loans"] }),
      queryClient.invalidateQueries({ queryKey: ["payments"] }),
      queryClient.invalidateQueries({ queryKey: ["buyers-for-seller"] }),
      queryClient.invalidateQueries({ queryKey: ["pending-kyc"] }),
      queryClient.invalidateQueries({ queryKey: ["emi-applications"] }),
      queryClient.invalidateQueries({ queryKey: ["overdue"] }),
      queryClient.invalidateQueries({ queryKey: ["collections"] })
    ]);
  }

  function buildLoanPayload() {
    return {
      buyerId: loanForm.buyerId,
      productId: loanForm.productId,
      principal: Number(loanForm.principal),
      downPayment: Number(loanForm.downPayment),
      interestRate: Number(loanForm.interestRate),
      interestType: loanForm.interestType,
      tenureMonths: Number(loanForm.tenureMonths),
      lateFeePolicy: { type: loanForm.lateFeeType, value: Number(loanForm.lateFeeValue) }
    };
  }

  function handleProductForLoan(productId) {
    const product = activeProducts.find((item) => item._id === productId);
    setLoanForm({ ...loanForm, productId, principal: product ? String(product.price) : loanForm.principal });
    setSchedulePreview(null);
  }

  function formatBDT(value) {
    return `BDT ${Math.round(Number(value || 0)).toLocaleString("en-BD")}`;
  }

  return (
    <section className="seller-dashboard">
      <div className="seller-header">
        <div>
          <h1>Seller Dashboard</h1>
          <p>Use the left sidebar to switch between overview, offline loan creation, payments, and product management pages.</p>
        </div>
      </div>

      <div className="seller-dashboard-layout">
        <aside className="seller-sidebar">
          <div className="sidebar-brand">
            <Package size={20} />
            <span>Seller Hub</span>
          </div>

          <nav className="sidebar-nav">
            {tabs.map((tab) => (
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
                  <p>High-level seller metrics, overdue risk, and recent activity.</p>
                </div>
                <button className="button secondary" onClick={refreshData}><RefreshCcw size={16} /> Refresh data</button>
              </div>

              <div className="stats-grid">
                <StatCard label="Total sales" value={formatBDT(summary.data?.totalSales)} tone="green" />
                <StatCard label="Total collection" value={formatBDT(summary.data?.totalCollection)} tone="purple" />
                <StatCard label="Total overdue" value={formatBDT(summary.data?.totalOverdueAmount)} tone="red" />
                <StatCard label="Active EMI loans" value={activeLoans.length} tone="green" />
                <StatCard label="Pending requests" value={requestedCount} />
                <StatCard label="Overdue cases" value={overdue.data?.length ?? 0} tone="red" />
                <StatCard label="Collected this month" value={formatBDT(summary.data?.monthlyCollection)} tone="purple" />
              </div>

              <section className="panel">
                <h2><BarChart3 size={18} /> Sales, collection, and overdue</h2>
                <div className="chart-box">
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={overviewChartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" />
                      <YAxis />
                      <Tooltip formatter={(value) => formatBDT(value)} />
                      <Bar dataKey="amount" fill="#247a78" radius={[5, 5, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <section className="panel">
                <h2>Overdue loans and risk score</h2>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Buyer</th>
                        <th>Product / Loan</th>
                        <th>Installment</th>
                        <th>Due date</th>
                        <th>Overdue amount</th>
                        <th>Days</th>
                        <th>Risk score</th>
                        <th>Risk</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(overdue.data || []).length === 0 ? (
                        <tr><td colSpan="8" style={{ textAlign: "center", color: "#888" }}>No overdue EMI loans right now.</td></tr>
                      ) : (
                        (overdue.data || []).map((row) => (
                          <tr key={row._id}>
                            <td>
                              <strong>{row.buyerId?.name || "Buyer"}</strong><br />
                              <span style={{ fontSize: "0.85rem", color: "#697b77" }}>{row.buyerId?.phone || row.buyerId?.email}</span>
                            </td>
                            <td>
                              {row.loanId?.productId?.name || "Offline/custom loan"}<br />
                              <span style={{ fontSize: "0.78rem", color: "#697b77" }}>{row.loanId?._id || row.loanId}</span>
                            </td>
                            <td>#{row.installmentNo}</td>
                            <td>{dayjs(row.dueDate).format("DD MMM YYYY")}</td>
                            <td>{formatBDT(row.balance)}</td>
                            <td>{row.daysOverdue}</td>
                            <td>{Number(row.riskScore || 0).toFixed(2)}</td>
                            <td><StatusBadge status={row.riskCategory} /></td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}

          {activeTab === "onlineRequests" && (
            <section className="panel">
              <div className="page-title">
                <div>
                  <h2>Online EMI requests</h2>
                  <p>Review marketplace EMI applications, confirm buyer KYC status, then approve or reject the request.</p>
                </div>
                <button className="button secondary" onClick={refreshData}><RefreshCcw size={16} /> Refresh</button>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Buyer</th>
                      <th>Product</th>
                      <th>Principal</th>
                      <th>Down payment</th>
                      <th>Terms</th>
                      <th>Risk</th>
                      <th>KYC</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requestedLoans.length === 0 ? (
                      <tr><td colSpan="8" style={{ textAlign: "center", color: "#888" }}>No online EMI requests pending.</td></tr>
                    ) : (
                      requestedLoans.map((loan) => {
                        const kycDoc = kycByBuyerId.get(loan.buyerId?._id);
                        const application = applicationByLoanId.get(loan._id);
                        return (
                          <tr key={loan._id}>
                            <td>
                              <strong>{loan.buyerId?.name || "Buyer"}</strong><br />
                              <span style={{ fontSize: "0.85rem", color: "#697b77" }}>{loan.buyerId?.phone || loan.buyerId?.email}</span>
                            </td>
                            <td>{loan.productId?.name || "Marketplace product"}</td>
                            <td>BDT {loan.principal}</td>
                            <td>BDT {loan.downPayment}</td>
                            <td>{loan.tenureMonths} months, {loan.interestRate}% {loan.interestType}</td>
                            <td>{application ? `${application.riskScoreSnapshot} / ${application.riskCategorySnapshot}` : "-"}</td>
                            <td>
                              {kycDoc ? (
                                <StatusBadge status={kycDoc.status} />
                              ) : (
                                <span className="badge pending">KYC required</span>
                              )}
                            </td>
                            <td className="table-action-cell">
                              <button
                                className="button tiny"
                                onClick={() => approveOnlineRequest.mutate(loan._id)}
                                disabled={approveOnlineRequest.isPending || rejectOnlineRequest.isPending}
                              >
                                <CheckCircle2 size={14} /> Approve
                              </button>
                              <button
                                className="button tiny danger"
                                onClick={() => rejectOnlineRequest.mutate({ loanId: loan._id, reason: "Rejected by seller" })}
                                disabled={approveOnlineRequest.isPending || rejectOnlineRequest.isPending}
                              >
                                <XCircle size={14} /> Reject
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <p className="hint">Approval requires the buyer KYC to be approved first. If approval fails, open the KYC requests tab and review the buyer documents.</p>
            </section>
          )}

          {activeTab === "createLoan" && (
            <section className="panel">
              <div className="page-title">
                <div>
                  <h2>Create offline loan</h2>
                  <p>Register an offline EMI loan for a buyer and product.</p>
                </div>
              </div>

              <div className="form-grid">
                <SearchableSelect
                  label="Buyer"
                  value={loanForm.buyerId}
                  onChange={(buyerId) => setLoanForm({ ...loanForm, buyerId })}
                  options={buyers.data || []}
                  placeholder="Select buyer"
                  searchPlaceholder="Search buyer by name, email, or phone"
                  getOptionValue={(buyer) => buyer._id}
                  getOptionLabel={(buyer) => `${buyer.name || "Unnamed buyer"}${buyer.email ? ` - ${buyer.email}` : ""}${buyer.phone ? ` - ${buyer.phone}` : ""}`}
                />
                <SearchableSelect
                  label="Product"
                  value={loanForm.productId}
                  onChange={handleProductForLoan}
                  options={activeProducts}
                  placeholder="Select product"
                  searchPlaceholder="Search product by name, category, or price"
                  getOptionValue={(product) => product._id}
                  getOptionLabel={(product) => `${product.name} - ${product.category || "General"} - BDT ${product.price}`}
                />
                <label>Principal amount (BDT)
                  <input placeholder="Example: 22000" type="number" value={loanForm.principal} onChange={(e) => setLoanForm({ ...loanForm, principal: e.target.value })} />
                </label>
                <label>Down payment (BDT)
                  <input placeholder="Example: 4000" type="number" value={loanForm.downPayment} onChange={(e) => setLoanForm({ ...loanForm, downPayment: e.target.value })} />
                </label>
              </div>

              <div className="form-grid">
                <label>Annual interest rate (%)
                  <input placeholder="Example: 12" type="number" value={loanForm.interestRate} onChange={(e) => setLoanForm({ ...loanForm, interestRate: e.target.value })} />
                </label>
                <label>Tenure (months)
                  <input placeholder="Example: 6" type="number" value={loanForm.tenureMonths} onChange={(e) => setLoanForm({ ...loanForm, tenureMonths: e.target.value })} />
                </label>
                <label>Interest type
                  <select value={loanForm.interestType} onChange={(e) => setLoanForm({ ...loanForm, interestType: e.target.value })}>
                    <option value="flat">Flat interest</option>
                    <option value="reducing">Reducing balance</option>
                    <option value="zero">Zero interest</option>
                  </select>
                </label>
                <label>Late fee policy
                  <select value={loanForm.lateFeeType} onChange={(e) => setLoanForm({ ...loanForm, lateFeeType: e.target.value })}>
                    <option value="daily">Daily late fee</option>
                    <option value="fixed">Fixed late fee</option>
                    <option value="percentage">EMI percentage late fee</option>
                    <option value="none">No late fee</option>
                  </select>
                </label>
                <label>Late fee value
                  <input placeholder="Example: 20" type="number" value={loanForm.lateFeeValue} onChange={(e) => setLoanForm({ ...loanForm, lateFeeValue: e.target.value })} />
                </label>
              </div>

              <div className="button-row">
                <button className="button secondary" onClick={() => previewSchedule.mutate()} disabled={!loanForm.principal || !loanForm.tenureMonths || previewSchedule.isPending}>Preview schedule</button>
                <button className="button" onClick={() => createLoan.mutate()} disabled={!loanForm.buyerId || !loanForm.principal || !loanForm.productId || createLoan.isPending}>Create loan</button>
              </div>

              {schedulePreview && (
                <div className="schedule-preview">
                  <div className="schedule-preview-summary">
                    <strong>Financed: BDT {schedulePreview.financed}</strong>
                    <strong>Total payable: BDT {schedulePreview.totalPayable}</strong>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>#</th><th>Due date</th><th>Principal</th><th>Interest</th><th>Amount due</th></tr></thead>
                      <tbody>
                        {schedulePreview.schedule.map((row) => (
                          <tr key={row.installmentNo}>
                            <td>{row.installmentNo}</td>
                            <td>{dayjs(row.dueDate).format("DD MMM YYYY")}</td>
                            <td>BDT {row.principalAmount}</td>
                            <td>BDT {row.interestAmount}</td>
                            <td>BDT {row.amountDue}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          )}

          {activeTab === "recordPayment" && (
            <section className="panel">
              <div className="page-title">
                <div>
                  <h2>Record payment</h2>
                  <p>Log payments against active EMI loans.</p>
                </div>
              </div>

              <div className="form-grid">
                <SearchableSelect
                  label="Active loan"
                  value={paymentForm.loanId}
                  onChange={(loanId) => setPaymentForm({ ...paymentForm, loanId })}
                  options={activeLoans}
                  placeholder="Select active loan"
                  searchPlaceholder="Search loan by buyer, product, amount, or ID"
                  getOptionValue={(loan) => loan._id}
                  getOptionLabel={(loan) => `${loan.buyerId?.name || "Buyer"} - ${loan.productId?.name || "Offline loan"} - BDT ${loan.totalPayable} - ${loan._id}`}
                />
                <label>Payment amount (BDT)
                  <input placeholder="Example: 3000" type="number" value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} />
                </label>
                <label>Payment method
                  <select value={paymentForm.method} onChange={(e) => setPaymentForm({ ...paymentForm, method: e.target.value })}>
                    <option value="cash">Cash</option>
                    <option value="bank">Bank transfer</option>
                    <option value="cheque">Cheque</option>
                  </select>
                </label>
                <label>Allocation mode
                  <select value={paymentForm.allocationMode} onChange={(e) => setPaymentForm({ ...paymentForm, allocationMode: e.target.value })}>
                    <option value="next_due">Next installment only</option>
                    <option value="overdue">Overdue balance only</option>
                    <option value="advance">Advance against all open installments</option>
                    <option value="custom">Custom amount</option>
                  </select>
                </label>
                <label>Payment notes
                  <input placeholder="Example: Paid at shop counter" value={paymentForm.notes} onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })} />
                </label>
              </div>

              <button className="button" onClick={() => recordPayment.mutate()} disabled={!paymentForm.loanId || !paymentForm.amount}>Submit payment</button>
            </section>
          )}

          {activeTab === "addProduct" && (
            <section className="panel">
              <div className="page-title">
                <div>
                  <h2>Add products</h2>
                  <p>Create a new product listing for EMI sales.</p>
                </div>
              </div>

              <div className="form-grid">
                <label>Product name
                  <input placeholder="Example: Samsung Phone" value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} />
                </label>
                <label>Category
                  <input placeholder="Example: Mobile" value={productForm.category} onChange={(e) => setProductForm({ ...productForm, category: e.target.value })} />
                </label>
                <label>Price (BDT)
                  <input placeholder="Example: 25000" type="number" value={productForm.price} onChange={(e) => setProductForm({ ...productForm, price: e.target.value })} />
                </label>
                <label>Stock quantity
                  <input placeholder="Example: 10" type="number" value={productForm.stock} onChange={(e) => setProductForm({ ...productForm, stock: e.target.value })} />
                </label>
              </div>
              <label>Product description
                <textarea placeholder="Short description shown in marketplace" value={productForm.description} onChange={(e) => setProductForm({ ...productForm, description: e.target.value })} />
              </label>
              <label className="file-label">
                Upload images <span className="hint">(optional)</span>
                <input type="file" accept="image/*" multiple onChange={(e) => setProductImages(Array.from(e.target.files || []).slice(0, 5))}/>
              </label>
              {productImagePreviews.length > 0 && (
                <div className="image-preview-row">
                  {productImagePreviews.map((image) => (
                    <div className="image-preview" key={image.url}>
                      <img src={image.url} alt={image.name} />
                      <span>{image.name}</span>
                    </div>
                  ))}
                </div>
              )}
              <label className="inline-check"><input type="checkbox" checked={productForm.emiAvailable} onChange={(e) => setProductForm({ ...productForm, emiAvailable: e.target.checked })} /> EMI available</label>
              <button className="button" onClick={() => createProduct.mutate()} disabled={!productForm.name || !productForm.price || !productForm.stock}>Save product</button>
            </section>
          )}

          {activeTab === "myProducts" && (
            <section className="panel">
              <div className="page-title">
                <div>
                  <h2>My products</h2>
                  <p>View and manage the products you have listed.</p>
                </div>
              </div>

              <div className="table-wrap">
                <table>
                  <thead><tr><th>Image</th><th>Name</th><th>Category</th><th>Price</th><th>Stock</th><th>EMI</th></tr></thead>
                  <tbody>
                    {(products.data || []).length === 0 ? (
                      <tr><td colSpan="6" style={{ textAlign: "center", color: "#888" }}>No products available</td></tr>
                    ) : (
                      (products.data || []).map((product) => (
                        <tr key={product._id}>
                          <td>{product.images?.[0]?.path ? <img className="table-thumb" src={product.images[0].path} alt={product.name} /> : <span className="badge">No image</span>}</td>
                          <td>{product.name}</td>
                          <td>{product.category}</td>
                          <td>BDT {product.price}</td>
                          <td>{product.stock}</td>
                          <td>{product.emiAvailable ? "Yes" : "No"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeTab === "activeLoans" && (
            <section className="panel">
              <div className="page-title">
                <div>
                  <h2>Active EMI loans</h2>
                  <p>See all currently active loans and open loan details.</p>
                </div>
              </div>

              <div className="table-wrap">
                <table>
                  <thead><tr><th>Buyer</th><th>Total payable</th><th>Status</th><th>Action</th></tr></thead>
                  <tbody>
                    {activeLoans.length === 0 ? (
                      <tr><td colSpan="4" style={{ textAlign: "center", color: "#888" }}>No active loans</td></tr>
                    ) : (
                      activeLoans.map((loan) => (
                        <tr key={loan._id}>
                          <td>{loan.buyerId?.name}</td>
                          <td>BDT {loan.totalPayable}</td>
                          <td><StatusBadge status={loan.status} /></td>
                          <td><button className="button tiny" onClick={() => setLoanDetailsModal(loan)}><Eye size={14} /> View</button></td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeTab === "kycRequests" && (
            <section className="panel">
              <div className="page-title">
                <div>
                  <h2>KYC requests</h2>
                  <p>Review pending KYC documents submitted by buyers requesting EMI.</p>
                </div>
              </div>

              <div className="form-grid">
                <label>Rejection reason
                  <textarea
                    placeholder="Optional reason shown if you reject a buyer KYC document"
                    value={kycRejectReason}
                    onChange={(e) => setKycRejectReason(e.target.value)}
                  />
                </label>
              </div>

              <div className="table-wrap">
                <table>
                  <thead><tr><th>Buyer</th><th>Type</th><th>Files</th><th>Action</th></tr></thead>
                  <tbody>
                    {(pendingKyc.data || []).length === 0 ? (
                      <tr><td colSpan="4" style={{ textAlign: "center", color: "#888" }}>No pending KYC documents</td></tr>
                    ) : (
                      (pendingKyc.data || []).map((doc) => (
                        <tr key={doc._id}>
                          <td>{doc.userId?.name}<br /><span style={{ fontSize: "0.85rem", color: "#888" }}>{doc.userId?.email}</span></td>
                          <td>{doc.type.toUpperCase()}</td>
                          <td>
                            {(doc.files || []).map((file) => (
                              <div key={file.filename}>
                                <button className="button tiny ghost" type="button" onClick={() => openProtectedFile(file.downloadUrl)}>{file.originalName}</button>
                              </div>
                            ))}
                            {doc.selfie && (
                              <div><button className="button tiny ghost" type="button" onClick={() => openProtectedFile(doc.selfie.downloadUrl)}>Selfie</button></div>
                            )}
                          </td>
                          <td className="table-action-cell">
                            <button className="button tiny" onClick={() => approveKyc.mutate(doc._id)}>Approve</button>
                            <button
                              className="button tiny danger"
                              onClick={() => rejectKyc.mutate({ kycId: doc._id, reason: kycRejectReason })}
                            >Reject</button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeTab === "paymentHistory" && (
            <section className="panel">
              <div className="page-title">
                <div>
                  <h2>Payment history</h2>
                  <p>Track recorded payments and download receipts.</p>
                </div>
              </div>

              <div className="table-wrap">
                <table>
                  <thead><tr><th>Receipt</th><th>Buyer</th><th>Amount</th><th>Date</th><th>Action</th></tr></thead>
                  <tbody>
                    {(payments.data || []).length === 0 ? (
                      <tr><td colSpan="5" style={{ textAlign: "center", color: "#888" }}>No payment history found</td></tr>
                    ) : (
                      (payments.data || []).map((payment) => (
                        <tr key={payment._id}>
                          <td>{payment.receiptNo || "—"}</td>
                          <td>{payment.buyerId?.name || payment.buyerId?.email}</td>
                          <td>BDT {payment.amount}</td>
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

      {loanDetailsModal && (
        <div className="modal-backdrop" onClick={() => setLoanDetailsModal(null)}>
          <form className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Loan details</h2>
            <div className="panel">
              <p><strong>Buyer:</strong> {loanDetailsModal.buyerId?.name}</p>
              <p><strong>Product:</strong> {loanDetailsModal.productId?.name || "Offline"}</p>
              <p><strong>Principal:</strong> BDT {loanDetailsModal.principal}</p>
              <p><strong>Total payable:</strong> BDT {loanDetailsModal.totalPayable}</p>
              <p><strong>Status:</strong> {loanDetailsModal.status}</p>
            </div>
            <button type="button" className="button" onClick={() => setLoanDetailsModal(null)} style={{ marginTop: "12px" }}>Close</button>
          </form>
        </div>
      )}
    </section>
  );
}
