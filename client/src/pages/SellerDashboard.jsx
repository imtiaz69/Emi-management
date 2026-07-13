import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, CheckCircle2, Eye, Package, RefreshCcw, XCircle } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import dayjs from "dayjs";
import { api, openProtectedFile } from "../api/http";
import StatCard from "../components/StatCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { generateReceiptPdf } from "../utils/receipt.js";
import { notifyError, notifyInfo, notifySuccess } from "../utils/toast.js";

const tabs = [
  { key: "overview", label: "Overview" },
  { key: "onlineRequests", label: "Online EMI requests" },
  { key: "createLoan", label: "Create offline loan" },
  { key: "recordPayment", label: "Record payment" },
  { key: "addProduct", label: "Add products" },
  { key: "myProducts", label: "My products" },
  { key: "orders", label: "Orders" },
  { key: "activeLoans", label: "Active EMI loans" },
  { key: "paymentHistory", label: "Payment history" },
  { key: "reports", label: "Reports" },
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

function defaultProductColors() {
  return [{ name: "Black", hex: "#111827" }];
}

function ColorInputs({ colors, onChange }) {
  const rows = colors?.length ? colors : defaultProductColors();

  function updateColor(index, patch) {
    onChange(rows.map((color, currentIndex) => (currentIndex === index ? { ...color, ...patch } : color)));
  }

  function addColor() {
    onChange([...rows, { name: "", hex: "#64748b" }]);
  }

  function removeColor(index) {
    onChange(rows.length === 1 ? rows : rows.filter((_color, currentIndex) => currentIndex !== index));
  }

  return (
    <div className="color-editor">
      <div className="section-heading-row">
        <div>
          <h3>Product colors</h3>
          <p className="hint">At least one color is required. Buyers will choose from these colors.</p>
        </div>
        <button type="button" className="button tiny secondary" onClick={addColor}>Add color</button>
      </div>
      <div className="color-editor-list">
        {rows.map((color, index) => (
          <div className="color-editor-row" key={`${color.hex}-${index}`}>
            <label>Color name
              <input placeholder="Example: Black" value={color.name || ""} onChange={(e) => updateColor(index, { name: e.target.value })} />
            </label>
            <label>Swatch
              <input type="color" value={color.hex || "#64748b"} onChange={(e) => updateColor(index, { hex: e.target.value })} />
            </label>
            <span className="color-chip"><span className="color-swatch" style={{ backgroundColor: color.hex || "#64748b" }} /> {color.name || "Color name"}</span>
            <button type="button" className="button tiny danger" disabled={rows.length === 1} onClick={() => removeColor(index)}>Remove</button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SellerDashboard() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("overview");
  const [productForm, setProductForm] = useState({
    name: "",
    category: "Mobile",
    price: "",
    stock: "",
    description: "",
    emiAvailable: true,
    emiInterestRate: "12",
    emiInterestType: "flat",
    emiMinDownPayment: "0",
    emiMaxTenureMonths: "12",
    colors: defaultProductColors()
  });
  const [productImages, setProductImages] = useState([]);
  const [loanForm, setLoanForm] = useState({ buyerId: "", productId: "", principal: "", downPayment: "0", interestRate: "12", interestType: "flat", tenureMonths: "6", lateFeeType: "daily", lateFeeValue: "20" });
  const [schedulePreview, setSchedulePreview] = useState(null);
  const [paymentForm, setPaymentForm] = useState({ loanId: "", amount: "", method: "cash", allocationMode: "next_due", notes: "" });
  const [kycRejectReason, setKycRejectReason] = useState("");
  const [loanDetailsModal, setLoanDetailsModal] = useState(null);
  const [editingProduct, setEditingProduct] = useState(null);
  const [editingProductImages, setEditingProductImages] = useState([]);
  const [editingReplaceImages, setEditingReplaceImages] = useState(false);
  const [editingStockAddition, setEditingStockAddition] = useState({ quantity: "", note: "" });
  const [stockAdjustment, setStockAdjustment] = useState({ productId: "", quantity: "", note: "" });

  const summary = useQuery({ queryKey: ["summary"], queryFn: async () => (await api.get("/reports/summary")).data });
  const products = useQuery({ queryKey: ["seller-products"], queryFn: async () => (await api.get("/products/mine")).data });
  const loans = useQuery({ queryKey: ["loans"], queryFn: async () => (await api.get("/loans")).data });
  const payments = useQuery({ queryKey: ["payments"], queryFn: async () => (await api.get("/payments")).data });
  const buyers = useQuery({ queryKey: ["buyers-for-seller"], queryFn: async () => (await api.get("/users", { params: { role: "buyer", status: "active" } })).data });
  const pendingKyc = useQuery({ queryKey: ["pending-kyc"], queryFn: async () => (await api.get("/kyc/pending-for-seller")).data });
  const applications = useQuery({ queryKey: ["emi-applications"], queryFn: async () => (await api.get("/emi-applications")).data });
  const overdue = useQuery({ queryKey: ["overdue"], queryFn: async () => (await api.get("/reports/overdue")).data });
  const collections = useQuery({ queryKey: ["collections"], queryFn: async () => (await api.get("/reports/collections")).data });
  const orders = useQuery({ queryKey: ["seller-orders"], queryFn: async () => (await api.get("/orders")).data });
  const salesReport = useQuery({ queryKey: ["report-sales"], queryFn: async () => (await api.get("/reports/sales")).data });
  const portfolioReport = useQuery({ queryKey: ["report-portfolio"], queryFn: async () => (await api.get("/reports/emi-portfolio")).data });
  const orderReport = useQuery({ queryKey: ["report-orders"], queryFn: async () => (await api.get("/reports/orders")).data });
  const downPaymentReport = useQuery({ queryKey: ["report-down-payments"], queryFn: async () => (await api.get("/reports/down-payments")).data });
  const paymentMethods = useQuery({ queryKey: ["report-payment-methods"], queryFn: async () => (await api.get("/reports/payment-methods")).data });

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
    { label: "Sales", amount: summary.data?.totalSales || 0 },
    { label: "Collection", amount: summary.data?.totalCollection || 0 },
    { label: "Due", amount: summary.data?.totalDue || summary.data?.dueAmount || 0 }
  ];
  const productImagePreviews = useMemo(() => productImages.map((file) => ({ name: file.name, url: URL.createObjectURL(file) })), [productImages]);
  const editingProductImagePreviews = useMemo(() => editingProductImages.map((file) => ({ name: file.name, url: URL.createObjectURL(file) })), [editingProductImages]);
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
      formData.append("emiInterestRate", productForm.emiInterestRate);
      formData.append("emiInterestType", productForm.emiInterestType);
      formData.append("emiMinDownPayment", productForm.emiMinDownPayment);
      formData.append("emiMaxTenureMonths", productForm.emiMaxTenureMonths);
      formData.append("colors", JSON.stringify(productForm.colors));
      productImages.slice(0, 5).forEach((file) => formData.append("images", file));
      return api.post("/products", formData);
    },
    onSuccess: () => {
      setProductForm({ name: "", category: "Mobile", price: "", stock: "", description: "", emiAvailable: true, emiInterestRate: "12", emiInterestType: "flat", emiMinDownPayment: "0", emiMaxTenureMonths: "12", colors: defaultProductColors() });
      setProductImages([]);
      queryClient.invalidateQueries({ queryKey: ["seller-products"] });
      queryClient.invalidateQueries({ queryKey: ["marketplace"] });
      queryClient.invalidateQueries({ queryKey: ["summary"] });
      notifySuccess("Product added successfully.");
    },
    onError: (err) => {
      notifyError(err, "Failed to add product.");
    }
  });

  const createLoan = useMutation({
    mutationFn: async () => api.post("/loans/offline", buildLoanPayload()),
    onSuccess: () => {
      setLoanForm({ buyerId: "", productId: "", principal: "", downPayment: "0", interestRate: "12", interestType: "flat", tenureMonths: "6", lateFeeType: "daily", lateFeeValue: "20" });
      setSchedulePreview(null);
      refreshData();
      notifySuccess("Offline loan created successfully.");
    },
    onError: (err) => {
      notifyError(err, "Failed to create offline loan.");
    }
  });

  const updateProduct = useMutation({
    mutationFn: async (payload) => {
      const imageFiles = payload.imageFiles || [];
      const updateFields = {
        name: payload.name,
        sku: payload.sku,
        category: payload.category,
        price: payload.price,
        lowStockThreshold: payload.lowStockThreshold,
        status: payload.status,
        description: payload.description,
        emiAvailable: payload.emiAvailable,
        emiInterestRate: payload.emiInterestRate,
        emiInterestType: payload.emiInterestType,
        emiMinDownPayment: payload.emiMinDownPayment,
        emiMaxTenureMonths: payload.emiMaxTenureMonths,
        colors: JSON.stringify(payload.colors || defaultProductColors()),
        replaceImages: payload.replaceImages
      };

      let response;
      if (imageFiles.length) {
        const formData = new FormData();
        Object.entries(updateFields).forEach(([key, value]) => {
          if (value !== undefined && value !== null) formData.append(key, value);
        });
        imageFiles.slice(0, 5).forEach((file) => formData.append("images", file));
        response = await api.patch(`/products/${payload._id}`, formData, { headers: { "Content-Type": "multipart/form-data" } });
      } else {
        response = await api.patch(`/products/${payload._id}`, updateFields);
      }

      const stockQuantity = Number(payload.stockToAdd || 0);
      if (stockQuantity > 0) {
        await api.post("/inventory/adjust", {
          productId: payload._id,
          quantity: stockQuantity,
          note: payload.stockNote || "Stock added from product edit"
        });
      }
      return response;
    },
    onSuccess: () => {
      closeEditProduct();
      refreshData();
      notifySuccess("Product updated successfully.");
    },
    onError: (err) => notifyError(err, "Failed to update product.")
  });

  const archiveProduct = useMutation({
    mutationFn: async (productId) => api.delete(`/products/${productId}`),
    onSuccess: () => {
      refreshData();
      notifySuccess("Product archived successfully.");
    },
    onError: (err) => notifyError(err, "Failed to archive product.")
  });

  const adjustStock = useMutation({
    mutationFn: async () => api.post("/inventory/adjust", { ...stockAdjustment, quantity: Number(stockAdjustment.quantity) }),
    onSuccess: () => {
      setStockAdjustment({ productId: "", quantity: "", note: "" });
      refreshData();
      notifySuccess("Stock adjusted successfully.");
    },
    onError: (err) => notifyError(err, "Failed to adjust stock.")
  });

  const previewSchedule = useMutation({
    mutationFn: async () => api.post("/loans/preview", buildLoanPayload()),
    onSuccess: ({ data }) => {
      setSchedulePreview(data);
      notifyInfo("EMI schedule preview generated.");
    },
    onError: (err) => {
      setSchedulePreview(null);
      notifyError(err, "Failed to preview EMI schedule.");
    }
  });

  const recordPayment = useMutation({
    mutationFn: async () => api.post("/payments/manual", { ...paymentForm, amount: Number(paymentForm.amount) }),
    onSuccess: () => {
      setPaymentForm({ loanId: "", amount: "", method: "cash", allocationMode: "next_due", notes: "" });
      refreshData();
      notifySuccess("Payment recorded successfully.");
    },
    onError: (err) => {
      notifyError(err, "Failed to record payment.");
    }
  });

  const approveKyc = useMutation({
    mutationFn: async (kycId) => api.patch(`/kyc/${kycId}/review-seller`, { status: "approved" }),
    onSuccess: () => {
      refreshData();
      notifySuccess("KYC approved successfully.");
    },
    onError: (err) => {
      notifyError(err, "Failed to approve KYC.");
    }
  });

  const rejectKyc = useMutation({
    mutationFn: async ({ kycId, reason }) => api.patch(`/kyc/${kycId}/review-seller`, { status: "rejected", rejectionReason: reason }),
    onSuccess: () => {
      setKycRejectReason("");
      refreshData();
      notifySuccess("KYC rejected successfully.");
    },
    onError: (err) => {
      notifyError(err, "Failed to reject KYC.");
    }
  });

  const approveOnlineRequest = useMutation({
    mutationFn: async (loanId) => api.patch(`/loans/${loanId}/approve`),
    onSuccess: () => {
      refreshData();
      notifySuccess("Online EMI request approved and EMI schedule generated.");
    },
    onError: (err) => {
      notifyError(err, "Failed to approve EMI request.");
    }
  });

  const rejectOnlineRequest = useMutation({
    mutationFn: async ({ loanId, reason }) => api.patch(`/loans/${loanId}/reject`, { reason }),
    onSuccess: () => {
      refreshData();
      notifySuccess("Online EMI request rejected.");
    },
    onError: (err) => {
      notifyError(err, "Failed to reject EMI request.");
    }
  });

  const updateOrderStatus = useMutation({
    mutationFn: async ({ orderId, fulfillmentStatus }) => api.patch(`/orders/${orderId}/status`, { fulfillmentStatus }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["seller-orders"] });
      queryClient.invalidateQueries({ queryKey: ["report-orders"] });
      notifySuccess("Order status updated.");
    },
    onError: (err) => notifyError(err, "Failed to update order.")
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
      queryClient.invalidateQueries({ queryKey: ["collections"] }),
      queryClient.invalidateQueries({ queryKey: ["seller-orders"] }),
      queryClient.invalidateQueries({ queryKey: ["report-sales"] }),
      queryClient.invalidateQueries({ queryKey: ["report-portfolio"] }),
      queryClient.invalidateQueries({ queryKey: ["report-orders"] }),
      queryClient.invalidateQueries({ queryKey: ["report-down-payments"] }),
      queryClient.invalidateQueries({ queryKey: ["report-payment-methods"] })
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

  function openEditProduct(product) {
    setEditingProduct({ ...product, colors: product.colors?.length ? product.colors : defaultProductColors() });
    setEditingProductImages([]);
    setEditingReplaceImages(false);
    setEditingStockAddition({ quantity: "", note: "" });
  }

  function closeEditProduct() {
    setEditingProduct(null);
    setEditingProductImages([]);
    setEditingReplaceImages(false);
    setEditingStockAddition({ quantity: "", note: "" });
  }

  function formatBDT(value) {
    return `BDT ${Math.round(Number(value || 0)).toLocaleString("en-BD")}`;
  }

  function buyerProfilePath(buyer) {
    const id = buyer?._id || buyer;
    return id ? `/buyers/${id}` : "";
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
                <StatCard label="Total due" value={formatBDT(summary.data?.totalDue)} tone="red" />
                <StatCard label="Cash sales" value={formatBDT(summary.data?.cashSales)} tone="green" />
                <StatCard label="EMI sales" value={formatBDT(summary.data?.emiSales)} tone="purple" />
                <StatCard label="Overdue amount" value={formatBDT(summary.data?.overdueAmount ?? summary.data?.totalOverdueAmount)} tone="red" />
                <StatCard label="Paid orders" value={summary.data?.paidOrderCount ?? 0} />
                <StatCard label="Unpaid orders" value={summary.data?.unpaidOrderCount ?? 0} tone="red" />
              </div>

              <section className="panel">
                <h2><BarChart3 size={18} /> Sales, collection, and due</h2>
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
                <h2>Business snapshot</h2>
                <div className="stats-grid">
                  <StatCard label="Cash collection" value={formatBDT(summary.data?.cashCollection)} tone="green" />
                  <StatCard label="EMI collection" value={formatBDT(summary.data?.emiCollection)} tone="purple" />
                  <StatCard label="Cash due" value={formatBDT(summary.data?.cashDue)} tone="red" />
                  <StatCard label="EMI due" value={formatBDT(summary.data?.emiDue ?? summary.data?.dueAmount)} tone="red" />
                  <StatCard label="Active loans" value={summary.data?.activeLoanCount ?? activeLoans.length} tone="green" />
                  <StatCard label="Pending EMI requests" value={summary.data?.requestedLoansCount ?? requestedCount} />
                  <StatCard label="Overdue cases" value={summary.data?.overdueCount ?? overdue.data?.length ?? 0} tone="red" />
                  <StatCard label="Low-stock products" value={(summary.data?.lowStockProducts || []).length} />
                </div>
                {(summary.data?.lowStockProducts || []).length > 0 && (
                  <div className="list-stack">
                    {(summary.data?.lowStockProducts || []).slice(0, 5).map((product) => (
                      <div className="list-row" key={product._id}>
                        <div><strong>{product.name}</strong><span>Stock {product.stock} | Alert at {product.lowStockThreshold}</span></div>
                        <span className="badge overdue">Low stock</span>
                      </div>
                    ))}
                  </div>
                )}
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
                              <strong>
                                {buyerProfilePath(row.buyerId) ? (
                                  <Link className="inline-profile-link" to={buyerProfilePath(row.buyerId)}>{row.buyerId?.name || "Buyer"}</Link>
                                ) : (
                                  row.buyerId?.name || "Buyer"
                                )}
                              </strong><br />
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
                              <strong>
                                {buyerProfilePath(loan.buyerId) ? (
                                  <Link className="inline-profile-link" to={buyerProfilePath(loan.buyerId)}>{loan.buyerId?.name || "Buyer"}</Link>
                                ) : (
                                  loan.buyerId?.name || "Buyer"
                                )}
                              </strong><br />
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
                              {buyerProfilePath(loan.buyerId) && <Link className="button tiny secondary" to={buyerProfilePath(loan.buyerId)}>Buyer</Link>}
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
              <ColorInputs colors={productForm.colors} onChange={(colors) => setProductForm({ ...productForm, colors })} />
              <section className="sub-panel">
                <h3>Seller EMI terms</h3>
                <div className="form-grid compact">
                  <label>Fixed interest rate (%)
                    <input type="number" min="0" max="100" placeholder="Example: 12" value={productForm.emiInterestRate} onChange={(e) => setProductForm({ ...productForm, emiInterestRate: e.target.value })} />
                  </label>
                  <label>Interest type
                    <select value={productForm.emiInterestType} onChange={(e) => setProductForm({ ...productForm, emiInterestType: e.target.value })}>
                      <option value="flat">Flat</option>
                      <option value="reducing">Reducing balance</option>
                      <option value="zero">Zero interest</option>
                    </select>
                  </label>
                  <label>Minimum down payment (BDT)
                    <input type="number" min="0" placeholder="Example: 4000" value={productForm.emiMinDownPayment} onChange={(e) => setProductForm({ ...productForm, emiMinDownPayment: e.target.value })} />
                  </label>
                  <label>Maximum tenure (months)
                    <input type="number" min="3" max="60" placeholder="Example: 12" value={productForm.emiMaxTenureMonths} onChange={(e) => setProductForm({ ...productForm, emiMaxTenureMonths: e.target.value })} />
                  </label>
                </div>
              </section>
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
              <button className="button" onClick={() => createProduct.mutate()} disabled={!productForm.name || !productForm.price || !productForm.stock || !productForm.colors?.every((color) => color.name)}>Save product</button>
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

              <div className="form-grid compact">
                <SearchableSelect
                  label="Stock product"
                  value={stockAdjustment.productId}
                  onChange={(productId) => setStockAdjustment({ ...stockAdjustment, productId })}
                  options={products.data || []}
                  placeholder="Select product"
                  searchPlaceholder="Search product for stock adjustment"
                  getOptionValue={(product) => product._id}
                  getOptionLabel={(product) => `${product.name} - stock ${product.stock}`}
                />
                <label>Adjustment quantity
                  <input type="number" placeholder="Example: 5 or -2" value={stockAdjustment.quantity} onChange={(e) => setStockAdjustment({ ...stockAdjustment, quantity: e.target.value })} />
                </label>
                <label>Adjustment note
                  <input placeholder="Example: Supplier restock" value={stockAdjustment.note} onChange={(e) => setStockAdjustment({ ...stockAdjustment, note: e.target.value })} />
                </label>
              </div>
              <button className="button secondary" onClick={() => adjustStock.mutate()} disabled={!stockAdjustment.productId || !stockAdjustment.quantity || adjustStock.isPending}>Adjust stock</button>

              <div className="table-wrap">
                <table>
                  <thead><tr><th>Image</th><th>Name</th><th>SKU</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th><th>EMI</th><th>Actions</th></tr></thead>
                  <tbody>
                    {(products.data || []).length === 0 ? (
                      <tr><td colSpan="9" style={{ textAlign: "center", color: "#888" }}>No products available</td></tr>
                    ) : (
                      (products.data || []).map((product) => (
                        <tr key={product._id}>
                          <td>{product.images?.[0]?.path ? <img className="table-thumb" src={product.images[0].path} alt={product.name} /> : <span className="badge">No image</span>}</td>
                          <td>{product.name}</td>
                          <td>{product.sku || "-"}</td>
                          <td>{product.category}</td>
                          <td>BDT {product.price}</td>
                          <td>{product.stock} {product.stock <= product.lowStockThreshold && <span className="badge overdue">Low</span>}</td>
                          <td><StatusBadge status={product.status} /></td>
                          <td>{product.emiAvailable ? `${product.emiInterestRate || 0}% / max ${product.emiMaxTenureMonths || 0}m` : "No"}</td>
                          <td className="table-action-cell">
                            <button className="button tiny" onClick={() => openEditProduct(product)}>Edit</button>
                            <button className="button tiny ghost" onClick={() => updateProduct.mutate({ ...product, status: product.status === "active" ? "inactive" : "active" })}>{product.status === "active" ? "Deactivate" : "Activate"}</button>
                            <button className="button tiny danger" onClick={() => archiveProduct.mutate(product._id)}>Archive</button>
                          </td>
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
              <div className="page-title">
                <div>
                  <h2>Seller order queue</h2>
                  <p>Confirm, ship, deliver, or inspect orders connected to your shop.</p>
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Order</th><th>Buyer</th><th>Total</th><th>Payment</th><th>Fulfillment</th><th>Address</th><th>Linked EMI</th><th>Actions</th></tr></thead>
                  <tbody>
                    {(orders.data || []).length === 0 ? (
                      <tr><td colSpan="8" style={{ textAlign: "center", color: "#888" }}>No seller orders yet.</td></tr>
                    ) : (
                      (orders.data || []).map((order) => (
                        <tr key={order._id}>
                          <td><Link to={`/orders/${order._id}`}>{order.orderNo}</Link></td>
                          <td>
                            {buyerProfilePath(order.buyerId) ? (
                              <Link className="inline-profile-link" to={buyerProfilePath(order.buyerId)}>{order.buyerId?.name || "Buyer"}</Link>
                            ) : (
                              order.buyerId?.name || "-"
                            )}
                          </td>
                          <td>{formatBDT(order.total)}</td>
                          <td><StatusBadge status={order.paymentStatus} /></td>
                          <td><StatusBadge status={order.fulfillmentStatus} /></td>
                          <td>{order.shippingAddress?.line1}, {order.shippingAddress?.city}</td>
                          <td>{(order.items || []).some((item) => item.loanId) ? "Yes" : "No"}</td>
                          <td className="table-action-cell">
                            <Link className="button tiny" to={`/orders/${order._id}`}>Details</Link>
                            {buyerProfilePath(order.buyerId) && <Link className="button tiny secondary" to={buyerProfilePath(order.buyerId)}>Buyer</Link>}
                            <button className="button tiny" onClick={() => updateOrderStatus.mutate({ orderId: order._id, fulfillmentStatus: "confirmed" })}>Confirm</button>
                            <button className="button tiny" onClick={() => updateOrderStatus.mutate({ orderId: order._id, fulfillmentStatus: "shipped" })}>Ship</button>
                            <button className="button tiny" onClick={() => updateOrderStatus.mutate({ orderId: order._id, fulfillmentStatus: "delivered" })}>Deliver</button>
                          </td>
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
                          <td>
                            {buyerProfilePath(loan.buyerId) ? (
                              <Link className="inline-profile-link" to={buyerProfilePath(loan.buyerId)}>{loan.buyerId?.name || "Buyer"}</Link>
                            ) : (
                              loan.buyerId?.name
                            )}
                          </td>
                          <td>BDT {loan.totalPayable}</td>
                          <td><StatusBadge status={loan.status} /></td>
                          <td className="table-action-cell">
                            <button className="button tiny" onClick={() => setLoanDetailsModal(loan)}><Eye size={14} /> View</button>
                            {buyerProfilePath(loan.buyerId) && <Link className="button tiny secondary" to={buyerProfilePath(loan.buyerId)}>Buyer</Link>}
                          </td>
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
                          <td>
                            {buyerProfilePath(doc.userId) ? (
                              <Link className="inline-profile-link" to={buyerProfilePath(doc.userId)}>{doc.userId?.name || "Buyer"}</Link>
                            ) : (
                              doc.userId?.name
                            )}
                            <br /><span style={{ fontSize: "0.85rem", color: "#888" }}>{doc.userId?.email}</span>
                          </td>
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
                            {buyerProfilePath(doc.userId) && <Link className="button tiny secondary" to={buyerProfilePath(doc.userId)}>Buyer</Link>}
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
                  <thead><tr><th>Receipt</th><th>Buyer</th><th>Reference</th><th>Amount</th><th>Date</th><th>Action</th></tr></thead>
                  <tbody>
                    {(payments.data || []).length === 0 ? (
                      <tr><td colSpan="6" style={{ textAlign: "center", color: "#888" }}>No payment history found</td></tr>
                    ) : (
                      (payments.data || []).map((payment) => (
                        <tr key={payment._id}>
                          <td>{payment.receiptNo || "—"}</td>
                          <td>
                            {buyerProfilePath(payment.buyerId) ? (
                              <Link className="inline-profile-link" to={buyerProfilePath(payment.buyerId)}>{payment.buyerId?.name || payment.buyerId?.email || "Buyer"}</Link>
                            ) : (
                              payment.buyerId?.name || payment.buyerId?.email
                            )}
                          </td>
                          <td>{payment.loanId?._id || payment.loanId || payment.orderId?.orderNo || payment.orderId || "—"}</td>
                          <td>BDT {payment.amount}</td>
                          <td>{dayjs(payment.paymentDate).format("DD MMM YYYY")}</td>
                          <td className="table-action-cell">
                            <button className="button tiny" onClick={() => generateReceiptPdf(payment)}>Download</button>
                            {buyerProfilePath(payment.buyerId) && <Link className="button tiny secondary" to={buyerProfilePath(payment.buyerId)}>Buyer</Link>}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeTab === "reports" && (
            <section className="panel">
              <div className="page-title">
                <div>
                  <h2>Seller reports</h2>
                  <p>Sales, EMI portfolio, order fulfillment, down payments, and payment method split.</p>
                </div>
              </div>
              <div className="stats-grid">
                <StatCard label="Sales principal" value={formatBDT(salesReport.data?.totals?.principal)} tone="green" />
                <StatCard label="Portfolio outstanding" value={formatBDT(portfolioReport.data?.totals?.outstanding)} tone="red" />
                <StatCard label="Order total" value={formatBDT(orderReport.data?.totals?.orderTotal)} tone="purple" />
                <StatCard label="Down payments" value={formatBDT(downPaymentReport.data?.totals?.amount)} />
              </div>
              <div className="button-row">
                <button className="button tiny" onClick={() => openProtectedFile("/reports/export?type=sales&format=excel")}>Sales Excel</button>
                <button className="button tiny ghost" onClick={() => openProtectedFile("/reports/export?type=orders&format=excel")}>Orders Excel</button>
                <button className="button tiny ghost" onClick={() => openProtectedFile("/reports/export?type=emi-portfolio&format=pdf")}>Portfolio PDF</button>
                <button className="button tiny ghost" onClick={() => openProtectedFile("/reports/export?type=down-payments&format=excel")}>Down payment Excel</button>
              </div>
              <div className="work-grid">
                <section>
                  <h3>Payment method split</h3>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Method</th><th>Count</th><th>Amount</th></tr></thead>
                      <tbody>{(paymentMethods.data || []).map((row) => <tr key={row.method}><td>{row.method}</td><td>{row.count}</td><td>{formatBDT(row.amount)}</td></tr>)}</tbody>
                    </table>
                  </div>
                </section>
                <section>
                  <h3>Sales by product/category</h3>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Type</th><th>Product</th><th>Category</th><th>Principal</th><th>Total</th><th>Status</th></tr></thead>
                      <tbody>{(salesReport.data?.rows || []).slice(0, 10).map((row, index) => <tr key={`${row.saleType || "sale"}-${row.product}-${index}`}><td>{row.saleType || "EMI"}</td><td>{row.product}</td><td>{row.category}</td><td>{formatBDT(row.principal)}</td><td>{formatBDT(row.totalPayable)}</td><td>{row.status}</td></tr>)}</tbody>
                    </table>
                  </div>
                </section>
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
              <p>
                <strong>Buyer:</strong>{" "}
                {buyerProfilePath(loanDetailsModal.buyerId) ? (
                  <Link className="inline-profile-link" to={buyerProfilePath(loanDetailsModal.buyerId)}>{loanDetailsModal.buyerId?.name}</Link>
                ) : (
                  loanDetailsModal.buyerId?.name
                )}
              </p>
              <p><strong>Product:</strong> {loanDetailsModal.productId?.name || "Offline"}</p>
              <p><strong>Principal:</strong> BDT {loanDetailsModal.principal}</p>
              <p><strong>Total payable:</strong> BDT {loanDetailsModal.totalPayable}</p>
              <p><strong>Status:</strong> {loanDetailsModal.status}</p>
            </div>
            <button type="button" className="button" onClick={() => setLoanDetailsModal(null)} style={{ marginTop: "12px" }}>Close</button>
          </form>
        </div>
      )}

      {editingProduct && (
        <div className="modal-backdrop" onClick={closeEditProduct}>
          <form
            className="modal product-edit-modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              updateProduct.mutate({
                ...editingProduct,
                imageFiles: editingProductImages,
                replaceImages: editingReplaceImages,
                stockToAdd: editingStockAddition.quantity,
                stockNote: editingStockAddition.note
              });
            }}
          >
            <h2>Edit product</h2>
            <div className="form-grid compact">
              <label>Product name
                <input value={editingProduct.name || ""} onChange={(e) => setEditingProduct({ ...editingProduct, name: e.target.value })} />
              </label>
              <label>SKU
                <input value={editingProduct.sku || ""} onChange={(e) => setEditingProduct({ ...editingProduct, sku: e.target.value })} />
              </label>
              <label>Category
                <input value={editingProduct.category || ""} onChange={(e) => setEditingProduct({ ...editingProduct, category: e.target.value })} />
              </label>
              <label>Price
                <input type="number" value={editingProduct.price || ""} onChange={(e) => setEditingProduct({ ...editingProduct, price: Number(e.target.value) })} />
              </label>
              <label>Low stock alert
                <input type="number" value={editingProduct.lowStockThreshold ?? 3} onChange={(e) => setEditingProduct({ ...editingProduct, lowStockThreshold: Number(e.target.value) })} />
              </label>
              <label>Current stock
                <input type="number" value={editingProduct.stock ?? 0} disabled />
              </label>
              <label>Add new stock
                <input type="number" min="0" placeholder="Example: 10" value={editingStockAddition.quantity} onChange={(e) => setEditingStockAddition({ ...editingStockAddition, quantity: e.target.value })} />
              </label>
              <label>Stock note
                <input placeholder="Example: Supplier restock" value={editingStockAddition.note} onChange={(e) => setEditingStockAddition({ ...editingStockAddition, note: e.target.value })} />
              </label>
              <label>Status
                <select value={editingProduct.status || "active"} onChange={(e) => setEditingProduct({ ...editingProduct, status: e.target.value })}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
            </div>
            <label>Description
              <textarea value={editingProduct.description || ""} onChange={(e) => setEditingProduct({ ...editingProduct, description: e.target.value })} />
            </label>
            <ColorInputs colors={editingProduct.colors} onChange={(colors) => setEditingProduct({ ...editingProduct, colors })} />
            <section className="sub-panel">
              <h3>Seller EMI terms</h3>
              <div className="form-grid compact">
                <label>Fixed interest rate (%)
                  <input type="number" min="0" max="100" value={editingProduct.emiInterestRate ?? 12} onChange={(e) => setEditingProduct({ ...editingProduct, emiInterestRate: Number(e.target.value) })} />
                </label>
                <label>Interest type
                  <select value={editingProduct.emiInterestType || "flat"} onChange={(e) => setEditingProduct({ ...editingProduct, emiInterestType: e.target.value })}>
                    <option value="flat">Flat</option>
                    <option value="reducing">Reducing balance</option>
                    <option value="zero">Zero interest</option>
                  </select>
                </label>
                <label>Minimum down payment (BDT)
                  <input type="number" min="0" value={editingProduct.emiMinDownPayment ?? 0} onChange={(e) => setEditingProduct({ ...editingProduct, emiMinDownPayment: Number(e.target.value) })} />
                </label>
                <label>Maximum tenure (months)
                  <input type="number" min="3" max="60" value={editingProduct.emiMaxTenureMonths ?? 12} onChange={(e) => setEditingProduct({ ...editingProduct, emiMaxTenureMonths: Number(e.target.value) })} />
                </label>
              </div>
            </section>
            {(editingProduct.images || []).length > 0 && (
              <div className="image-preview-row">
                {(editingProduct.images || []).map((image) => (
                  <div className="image-preview" key={image.path || image.publicId}>
                    <img src={image.path} alt={editingProduct.name} />
                    <span>Current image</span>
                  </div>
                ))}
              </div>
            )}
            <label className="file-label">
              Upload product images
              <input type="file" accept="image/*" multiple onChange={(e) => setEditingProductImages(Array.from(e.target.files || []).slice(0, 5))} />
            </label>
            {editingProductImagePreviews.length > 0 && (
              <div className="image-preview-row">
                {editingProductImagePreviews.map((image) => (
                  <div className="image-preview" key={image.url}>
                    <img src={image.url} alt={image.name} />
                    <span>{image.name}</span>
                  </div>
                ))}
              </div>
            )}
            <label className="inline-check">
              <input type="checkbox" checked={editingReplaceImages} onChange={(e) => setEditingReplaceImages(e.target.checked)} />
              Replace current images
            </label>
            <label className="inline-check"><input type="checkbox" checked={Boolean(editingProduct.emiAvailable)} onChange={(e) => setEditingProduct({ ...editingProduct, emiAvailable: e.target.checked })} /> EMI available</label>
            <div className="button-row">
              <button className="button" disabled={updateProduct.isPending}>Save changes</button>
              <button type="button" className="button secondary" onClick={closeEditProduct}>Cancel</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
