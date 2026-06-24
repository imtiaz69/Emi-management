import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Eye, Menu, Package, RefreshCcw } from "lucide-react";
import dayjs from "dayjs";
import { api } from "../api/http";
import StatCard from "../components/StatCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { generateReceiptPdf } from "../utils/receipt.js";

const tabs = [
  { key: "overview", label: "Overview" },
  { key: "createLoan", label: "Create offline loan" },
  { key: "recordPayment", label: "Record payment" },
  { key: "addProduct", label: "Add products" },
  { key: "myProducts", label: "My products" },
  { key: "activeLoans", label: "Active EMI loans" },
  { key: "paymentHistory", label: "Payment history" },
  { key: "kycRequests", label: "KYC requests" }
];

export default function SellerDashboard() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("overview");
  const [productForm, setProductForm] = useState({ name: "", category: "Mobile", price: "", stock: "", description: "", emiAvailable: true });
  const [loanForm, setLoanForm] = useState({ buyerId: "", productId: "", principal: "", downPayment: "0", interestRate: "12", tenureMonths: "6", lateFeeType: "daily", lateFeeValue: "20" });
  const [paymentForm, setPaymentForm] = useState({ loanId: "", amount: "", method: "cash", notes: "" });
  const [kycRejectReason, setKycRejectReason] = useState("");
  const [loanDetailsModal, setLoanDetailsModal] = useState(null);

  const summary = useQuery({ queryKey: ["summary"], queryFn: async () => (await api.get("/reports/summary")).data });
  const products = useQuery({ queryKey: ["products"], queryFn: async () => (await api.get("/products")).data });
  const loans = useQuery({ queryKey: ["loans"], queryFn: async () => (await api.get("/loans")).data });
  const payments = useQuery({ queryKey: ["payments"], queryFn: async () => (await api.get("/payments")).data });
  const buyers = useQuery({ queryKey: ["buyers-for-seller"], queryFn: async () => (await api.get("/users", { params: { role: "buyer", status: "active" } })).data });
  const pendingKyc = useQuery({ queryKey: ["pending-kyc"], queryFn: async () => (await api.get("/kyc/pending-for-seller")).data });
  const overdue = useQuery({ queryKey: ["overdue"], queryFn: async () => (await api.get("/reports/overdue")).data });
  const collections = useQuery({ queryKey: ["collections"], queryFn: async () => (await api.get("/reports/collections")).data });

  const activeLoans = (loans.data || []).filter((loan) => loan.status === "active");
  const requestedCount = (summary.data?.requestedLoansCount ?? 0) || 0;
  const chartData = (collections.data || []).slice(0, 8).reverse().map((row) => ({ date: dayjs(row.paymentDate).format("DD MMM"), amount: row.amount }));

  const createProduct = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      formData.append("name", productForm.name);
      formData.append("category", productForm.category);
      formData.append("price", productForm.price);
      formData.append("stock", productForm.stock);
      formData.append("description", productForm.description);
      formData.append("emiAvailable", productForm.emiAvailable ? "true" : "false");
      return api.post("/products", formData);
    },
    onSuccess: () => {
      setProductForm({ name: "", category: "Mobile", price: "", stock: "", description: "", emiAvailable: true });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["summary"] });
      alert("Product added successfully.");
    },
    onError: (err) => {
      alert(err.response?.data?.message || "Failed to add product.");
    }
  });

  const createLoan = useMutation({
    mutationFn: async () =>
      api.post("/loans/offline", {
        buyerId: loanForm.buyerId,
        productId: loanForm.productId,
        principal: Number(loanForm.principal),
        downPayment: Number(loanForm.downPayment),
        interestRate: Number(loanForm.interestRate),
        tenureMonths: Number(loanForm.tenureMonths),
        lateFeePolicy: { type: loanForm.lateFeeType, value: Number(loanForm.lateFeeValue) }
      }),
    onSuccess: () => {
      setLoanForm({ buyerId: "", productId: "", principal: "", downPayment: "0", interestRate: "12", tenureMonths: "6", lateFeeType: "daily", lateFeeValue: "20" });
      refreshData();
      alert("Offline loan created successfully.");
    },
    onError: (err) => {
      alert(err.response?.data?.message || "Failed to create offline loan.");
    }
  });

  const recordPayment = useMutation({
    mutationFn: async () => api.post("/payments/manual", { ...paymentForm, amount: Number(paymentForm.amount) }),
    onSuccess: () => {
      setPaymentForm({ loanId: "", amount: "", method: "cash", notes: "" });
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

  async function refreshData() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["summary"] }),
      queryClient.invalidateQueries({ queryKey: ["products"] }),
      queryClient.invalidateQueries({ queryKey: ["loans"] }),
      queryClient.invalidateQueries({ queryKey: ["payments"] }),
      queryClient.invalidateQueries({ queryKey: ["buyers-for-seller"] }),
      queryClient.invalidateQueries({ queryKey: ["pending-kyc"] }),
      queryClient.invalidateQueries({ queryKey: ["overdue"] }),
      queryClient.invalidateQueries({ queryKey: ["collections"] })
    ]);
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
                <StatCard label="Active EMI loans" value={activeLoans.length} tone="green" />
                <StatCard label="Pending requests" value={requestedCount} />
                <StatCard label="Overdue cases" value={overdue.data?.length ?? 0} tone="red" />
                <StatCard label="Collected this month" value={`BDT ${Math.round(summary.data?.monthlyCollections || 0)}`} tone="purple" />
              </div>

              <section className="panel">
                <h2><BarChart3 size={18} /> Collections trend</h2>
                <div className="chart-box">
                  {chartData.length === 0 ? (
                    <p className="hint">No recent collection data available.</p>
                  ) : (
                    <div className="hint">Chart rendering placeholder for collection trend.</div>
                  )}
                </div>
              </section>
            </>
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
                <select value={loanForm.buyerId} onChange={(e) => setLoanForm({ ...loanForm, buyerId: e.target.value })}>
                  <option value="">Select buyer</option>
                  {(buyers.data || []).map((buyer) => (
                    <option key={buyer._id} value={buyer._id}>{buyer.name || buyer.email}</option>
                  ))}
                </select>
                <select value={loanForm.productId} onChange={(e) => setLoanForm({ ...loanForm, productId: e.target.value })}>
                  <option value="">Select product</option>
                  {(products.data || []).map((product) => (
                    <option key={product._id} value={product._id}>{product.name}</option>
                  ))}
                </select>
                <input placeholder="Principal amount" type="number" value={loanForm.principal} onChange={(e) => setLoanForm({ ...loanForm, principal: e.target.value })} />
                <input placeholder="Down payment" type="number" value={loanForm.downPayment} onChange={(e) => setLoanForm({ ...loanForm, downPayment: e.target.value })} />
              </div>

              <div className="form-grid">
                <input placeholder="Interest rate (%)" type="number" value={loanForm.interestRate} onChange={(e) => setLoanForm({ ...loanForm, interestRate: e.target.value })} />
                <input placeholder="Tenure (months)" type="number" value={loanForm.tenureMonths} onChange={(e) => setLoanForm({ ...loanForm, tenureMonths: e.target.value })} />
                <select value={loanForm.lateFeeType} onChange={(e) => setLoanForm({ ...loanForm, lateFeeType: e.target.value })}>
                  <option value="daily">Daily late fee</option>
                  <option value="fixed">Fixed late fee</option>
                </select>
                <input placeholder="Late fee value" type="number" value={loanForm.lateFeeValue} onChange={(e) => setLoanForm({ ...loanForm, lateFeeValue: e.target.value })} />
              </div>

              <button className="button" onClick={() => createLoan.mutate()} disabled={!loanForm.buyerId || !loanForm.principal || !loanForm.productId}>Create loan</button>
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
                <select value={paymentForm.loanId} onChange={(e) => setPaymentForm({ ...paymentForm, loanId: e.target.value })}>
                  <option value="">Select active loan</option>
                  {activeLoans.map((loan) => (
                    <option key={loan._id} value={loan._id}>{loan.buyerId?.name || "Buyer"} — BDT {loan.totalPayable}</option>
                  ))}
                </select>
                <input placeholder="Amount" type="number" value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} />
                <select value={paymentForm.method} onChange={(e) => setPaymentForm({ ...paymentForm, method: e.target.value })}>
                  <option value="cash">Cash</option>
                  <option value="bank">Bank transfer</option>
                  <option value="cheque">Cheque</option>
                </select>
                <input placeholder="Notes" value={paymentForm.notes} onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })} />
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
                <input placeholder="Name" value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} />
                <input placeholder="Category" value={productForm.category} onChange={(e) => setProductForm({ ...productForm, category: e.target.value })} />
                <input placeholder="Price (BDT)" type="number" value={productForm.price} onChange={(e) => setProductForm({ ...productForm, price: e.target.value })} />
                <input placeholder="Stock" type="number" value={productForm.stock} onChange={(e) => setProductForm({ ...productForm, stock: e.target.value })} />
              </div>
              <textarea placeholder="Description" value={productForm.description} onChange={(e) => setProductForm({ ...productForm, description: e.target.value })} />
              <label className="file-label">
                Upload images <span className="hint">(optional)</span>
                <input type="file" accept="image/*" multiple onChange={(e) => console.log("Image upload not enabled in this preview")}/>
              </label>
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
                  <thead><tr><th>Name</th><th>Category</th><th>Price</th><th>Stock</th><th>EMI</th></tr></thead>
                  <tbody>
                    {(products.data || []).length === 0 ? (
                      <tr><td colSpan="5" style={{ textAlign: "center", color: "#888" }}>No products available</td></tr>
                    ) : (
                      (products.data || []).map((product) => (
                        <tr key={product._id}>
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
                <textarea
                  placeholder="Optional rejection reason"
                  value={kycRejectReason}
                  onChange={(e) => setKycRejectReason(e.target.value)}
                />
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
                                <a href={file.path} target="_blank" rel="noreferrer">{file.originalName}</a>
                              </div>
                            ))}
                            {doc.selfie && (
                              <div><a href={doc.selfie.path} target="_blank" rel="noreferrer">Selfie</a></div>
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
