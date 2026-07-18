import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeDollarSign,
  BarChart3,
  Bell,
  Boxes,
  CheckCircle2,
  ClipboardCheck,
  ArrowUpRight,
  CalendarRange,
  Download,
  Eye,
  FileBarChart,
  FileSpreadsheet,
  FileText,
  HandCoins,
  History,
  LayoutDashboard,
  PackagePlus,
  ReceiptText,
  RefreshCcw,
  ShieldCheck,
  ShoppingCart,
  X,
  XCircle
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import dayjs from "dayjs";
import { api, openProtectedFile } from "../api/http";
import ProtectedDocumentViewer from "../components/ProtectedDocumentViewer.jsx";
import ProtectedImage from "../components/ProtectedImage.jsx";
import DashboardShell from "../components/DashboardShell.jsx";
import NotificationInbox from "../components/NotificationInbox.jsx";
import StatCard from "../components/StatCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { formatKycType } from "../utils/kyc.js";
import { notifyError, notifyInfo, notifySuccess } from "../utils/toast.js";

const tabs = [
  { key: "overview", label: "Overview", icon: LayoutDashboard, group: "Workspace" },
  { key: "notifications", label: "Notifications", icon: Bell, group: "Workspace" },
  { key: "onlineRequests", label: "Online EMI requests", icon: ClipboardCheck, group: "Lending" },
  { key: "createLoan", label: "Create offline loan", icon: HandCoins, group: "Lending" },
  { key: "recordPayment", label: "Record payment", icon: ReceiptText, group: "Lending" },
  { key: "activeLoans", label: "Active EMI loans", icon: BadgeDollarSign, group: "Lending" },
  { key: "kycRequests", label: "KYC requests", icon: ShieldCheck, group: "Lending" },
  { key: "addProduct", label: "Add products", icon: PackagePlus, group: "Commerce" },
  { key: "myProducts", label: "My products", icon: Boxes, group: "Commerce" },
  { key: "orders", label: "Orders", icon: ShoppingCart, group: "Commerce" },
  { key: "paymentHistory", label: "Payment history", icon: History, group: "Records" },
  { key: "reports", label: "Reports", icon: FileBarChart, group: "Records" }
];

const sellerTabKeys = new Set(tabs.map((tab) => tab.key));

function getInitialSellerTab(search) {
  const tab = new URLSearchParams(search).get("tab");
  return sellerTabKeys.has(tab) ? tab : "overview";
}

const overviewMetricMeta = {
  total_sales: { title: "Total product sales", description: "Paid cash product value after discounts plus active EMI principal.", monetary: true },
  cash_sales: { title: "Cash product sales", description: "Paid cash product value after discounts. Delivery charges are excluded.", monetary: true },
  emi_sales: { title: "EMI product sales", description: "Product principal for active, closed, and defaulted EMI loans.", monetary: true },
  total_collection: { title: "Total collected", description: "All confirmed cash receipts, EMI down payments, and installments.", monetary: true },
  cash_collection: { title: "Cash order receipts", description: "Confirmed cash-order receipts, including allocated delivery charges.", monetary: true },
  emi_collection: { title: "EMI collected", description: "Confirmed EMI down payments and installment payments.", monetary: true },
  monthly_collection: { title: "Collected this month", description: "Confirmed seller collections recorded during the current month.", monetary: true },
  delivery_collection: { title: "Delivery collected", description: "Delivery-charge portion included in confirmed cash receipts.", monetary: true },
  down_payments: { title: "Down payments collected", description: "Confirmed down payments for active EMI agreements.", monetary: true },
  installments: { title: "Installments collected", description: "Confirmed monthly and advance EMI installment payments.", monetary: true },
  finance_charge: { title: "EMI finance charge", description: "Expected interest above product principal across recognized EMI contracts.", monetary: true },
  late_fees: { title: "Late fees assessed", description: "All late fees added to EMI schedules, whether collected or outstanding.", monetary: true },
  total_due: { title: "EMI outstanding", description: "All unpaid future and overdue EMI schedule balances.", monetary: true },
  upcoming_due: { title: "Upcoming EMI", description: "Unpaid EMI balances whose due dates have not passed.", monetary: true },
  overdue: { title: "Overdue EMI", description: "Unpaid EMI balances whose due dates have passed.", monetary: true },
  active_loans: { title: "Active EMI loans", description: "Loans currently collecting monthly installments.", monetary: false },
  paid_cash_orders: { title: "Paid cash orders", description: "Cash orders with confirmed full payment.", monetary: false },
  unpaid_cash_orders: { title: "Awaiting cash payment", description: "Unpaid cash checkouts. These are not counted as sales or due.", monetary: true },
  pending_requests: { title: "Pending EMI requests", description: "EMI applications waiting for seller review.", monetary: false },
  awaiting_down_payments: { title: "Awaiting down payment", description: "Approved EMI applications waiting for confirmed down payment.", monetary: false },
  ready_delivery: { title: "Ready for delivery", description: "Paid cash or activated EMI orders ready for seller fulfillment.", monetary: false },
  low_stock: { title: "Low-stock products", description: "Active products at or below their configured alert threshold.", monetary: false }
};

const reportTypeOptions = [
  { value: "sales", label: "Sales performance" },
  { value: "collections", label: "Collections" },
  { value: "overdue", label: "Overdue and risk" },
  { value: "orders", label: "Orders and fulfillment" },
  { value: "emi-portfolio", label: "EMI portfolio" },
  { value: "down-payments", label: "EMI down payments" }
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
  const location = useLocation();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState(() => getInitialSellerTab(location.search));
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

  useEffect(() => {
    setActiveTab(getInitialSellerTab(location.search));
  }, [location.search]);
  const [editingStockAddition, setEditingStockAddition] = useState({ quantity: "", note: "" });
  const [stockAdjustment, setStockAdjustment] = useState({ productId: "", quantity: "", note: "" });
  const [overviewMetric, setOverviewMetric] = useState("");
  const [reportType, setReportType] = useState("sales");
  const [reportDates, setReportDates] = useState({ from: "", to: "" });
  const [reportExporting, setReportExporting] = useState("");

  const summary = useQuery({ queryKey: ["summary"], queryFn: async () => (await api.get("/reports/summary")).data });
  const overviewDetails = useQuery({
    queryKey: ["overview-detail", overviewMetric],
    queryFn: async () => (await api.get("/reports/summary/details", { params: { metric: overviewMetric } })).data,
    enabled: Boolean(overviewMetric)
  });
  const products = useQuery({ queryKey: ["seller-products"], queryFn: async () => (await api.get("/products/mine")).data });
  const loans = useQuery({ queryKey: ["loans"], queryFn: async () => (await api.get("/loans")).data });
  const payments = useQuery({ queryKey: ["payments"], queryFn: async () => (await api.get("/payments")).data });
  const buyers = useQuery({ queryKey: ["buyers-for-seller"], queryFn: async () => (await api.get("/users", { params: { role: "buyer", status: "active" } })).data });
  const pendingKyc = useQuery({ queryKey: ["pending-kyc"], queryFn: async () => (await api.get("/kyc/pending-for-seller")).data });
  const applications = useQuery({ queryKey: ["emi-applications"], queryFn: async () => (await api.get("/emi-applications")).data });
  const overdue = useQuery({ queryKey: ["overdue"], queryFn: async () => (await api.get("/reports/overdue")).data });
  const collections = useQuery({ queryKey: ["collections"], queryFn: async () => (await api.get("/reports/collections")).data });
  const orders = useQuery({
    queryKey: ["seller-orders"],
    queryFn: async () => (await api.get("/orders")).data,
    refetchInterval: 10000
  });
  const reportRangeInvalid = Boolean(reportDates.from && reportDates.to && dayjs(reportDates.from).isAfter(dayjs(reportDates.to)));
  const reportParams = {
    type: reportType,
    ...(reportDates.from && { from: reportDates.from }),
    ...(reportDates.to && { to: reportDates.to })
  };
  const reportPreview = useQuery({
    queryKey: ["report-preview", reportType, reportDates.from, reportDates.to],
    queryFn: async () => (await api.get("/reports/preview", { params: reportParams })).data,
    enabled: activeTab === "reports" && !reportRangeInvalid
  });
  const paymentMethods = useQuery({
    queryKey: ["report-payment-methods", reportDates.from, reportDates.to],
    queryFn: async () => (await api.get("/reports/payment-methods", { params: reportParams })).data,
    enabled: activeTab === "reports" && !reportRangeInvalid
  });

  const activeLoans = (loans.data || []).filter((loan) => loan.status === "active");
  const approvedLoans = (loans.data || []).filter((loan) => loan.status === "approved");
  const activeProducts = useMemo(() => (products.data || []).filter((product) => product.status === "active"), [products.data]);
  const requestedLoans = (loans.data || []).filter((loan) => loan.status === "requested");
  const reviewLoans = [...requestedLoans, ...approvedLoans];
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
    { label: "Product sales", amount: summary.data?.totalSales || 0, metric: "total_sales" },
    { label: "Collected", amount: summary.data?.totalCollection || 0, metric: "total_collection" },
    { label: "EMI outstanding", amount: summary.data?.totalDue || summary.data?.dueAmount || 0, metric: "total_due" }
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

  useEffect(() => {
    if (!overviewMetric) return undefined;
    function closeOnEscape(event) {
      if (event.key === "Escape") setOverviewMetric("");
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [overviewMetric]);

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
      notifySuccess("EMI request approved. Delivery and the monthly schedule will start after the Stripe down payment is confirmed.");
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
      queryClient.invalidateQueries({ queryKey: ["report-payment-methods"] }),
      queryClient.invalidateQueries({ queryKey: ["report-preview"] }),
      queryClient.invalidateQueries({ queryKey: ["overview-detail"] })
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

  function formatPaymentType(type) {
    if (type === "order_payment") return "Cash order";
    if (type === "down_payment") return "Down payment";
    if (type === "installment") return "EMI installment";
    return String(type || "Payment").replaceAll("_", " ");
  }

  function buyerProfilePath(buyer) {
    const id = buyer?._id || buyer;
    return id ? `/buyers/${id}` : "";
  }

  function isOrderReadyForFulfillment(order) {
    return (order.items || []).every((item) => {
      if (item.financeMode === "emi") return ["active", "closed"].includes(item.loanId?.status);
      return order.paymentStatus === "paid";
    });
  }

  function getDeliveryState(order) {
    if (["delivered", "cancelled", "returned"].includes(order.fulfillmentStatus)) return order.fulfillmentStatus;
    return isOrderReadyForFulfillment(order) ? "ready" : "waiting_payment";
  }

  function setReportPeriod(period) {
    if (period === "month") {
      setReportDates({
        from: dayjs().startOf("month").format("YYYY-MM-DD"),
        to: dayjs().format("YYYY-MM-DD")
      });
      return;
    }
    if (period === "year") {
      setReportDates({
        from: dayjs().startOf("year").format("YYYY-MM-DD"),
        to: dayjs().format("YYYY-MM-DD")
      });
      return;
    }
    setReportDates({ from: "", to: "" });
  }

  async function exportReport(format) {
    if (reportRangeInvalid) {
      notifyInfo("The report start date must be before the end date.");
      return;
    }
    setReportExporting(format);
    try {
      const params = new URLSearchParams({ ...reportParams, format });
      await openProtectedFile(`/reports/export?${params.toString()}`);
      notifySuccess(`${format === "pdf" ? "PDF" : "Excel"} report generated.`);
    } catch (error) {
      notifyError(error, "Unable to generate the report.");
    } finally {
      setReportExporting("");
    }
  }

  function formatReportCell(value, format) {
    if (format === "money") return formatBDT(value);
    if (format === "date") return value ? dayjs(value).format("DD MMM YYYY") : "—";
    if (format === "months") return `${Number(value || 0)} months`;
    return String(value ?? "—").replaceAll("_", " ");
  }

  function reportOverviewValue(value) {
    if (summary.isLoading) return "Loading...";
    if (summary.isError) return "Unavailable";
    return formatBDT(value);
  }

  return (
    <DashboardShell
      title={tabs.find((tab) => tab.key === activeTab)?.label || "Seller Dashboard"}
      description="Manage lending, products, orders, collections, KYC, and reports."
      roleLabel="Seller Workspace"
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={setActiveTab}
    >
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
                <StatCard
                  label="Total product sales"
                  value={formatBDT(summary.data?.totalSales)}
                  caption="Cash after discount + EMI principal"
                  tone="green"
                  onClick={() => setOverviewMetric("total_sales")}
                />
                <StatCard
                  label="Total collected"
                  value={formatBDT(summary.data?.totalCollection)}
                  caption="All confirmed receipts"
                  tone="purple"
                  onClick={() => setOverviewMetric("total_collection")}
                />
                <StatCard
                  label="EMI outstanding"
                  value={formatBDT(summary.data?.totalDue)}
                  caption="Upcoming + overdue schedules"
                  tone="red"
                  onClick={() => setOverviewMetric("total_due")}
                />
                <StatCard
                  label="Overdue EMI"
                  value={formatBDT(summary.data?.overdueAmount ?? summary.data?.totalOverdueAmount)}
                  caption={`${summary.data?.overdueCount ?? 0} overdue installment(s)`}
                  tone="red"
                  onClick={() => setOverviewMetric("overdue")}
                />
                <StatCard
                  label="Cash product sales"
                  value={formatBDT(summary.data?.cashSales)}
                  caption="Delivery excluded"
                  tone="green"
                  onClick={() => setOverviewMetric("cash_sales")}
                />
                <StatCard
                  label="EMI product sales"
                  value={formatBDT(summary.data?.emiSales)}
                  caption="Activated product principal"
                  tone="purple"
                  onClick={() => setOverviewMetric("emi_sales")}
                />
                <StatCard
                  label="Paid cash orders"
                  value={summary.data?.paidCashOrderCount ?? summary.data?.paidOrderCount ?? 0}
                  caption="Full payment confirmed"
                  onClick={() => setOverviewMetric("paid_cash_orders")}
                />
                <StatCard
                  label="Awaiting cash payment"
                  value={summary.data?.unpaidCashOrderCount ?? summary.data?.unpaidOrderCount ?? 0}
                  caption={`${formatBDT(summary.data?.unpaidCashOrderValue)} pending, not due`}
                  tone="red"
                  onClick={() => setOverviewMetric("unpaid_cash_orders")}
                />
              </div>

              <section className="panel">
                <h2><BarChart3 size={18} /> Sales, received, and outstanding</h2>
                <div className="chart-box">
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={overviewChartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" />
                      <YAxis />
                      <Tooltip formatter={(value) => formatBDT(value)} />
                      <Bar
                        dataKey="amount"
                        fill="#2ca58d"
                        radius={[5, 5, 0, 0]}
                        cursor="pointer"
                        onClick={(entry) => setOverviewMetric(entry?.metric || entry?.payload?.metric || "")}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <section className="panel">
                <div className="section-heading-row">
                  <div>
                    <h2>Accounting reconciliation</h2>
                    <p className="hint">Received plus outstanding should equal recognized product sales, finance charges, delivery receipts, and outstanding late fees.</p>
                  </div>
                  <StatusBadge status={Math.abs(Number(summary.data?.accountingDifference || 0)) < 0.01 ? "balanced" : "review"} />
                </div>
                <div className="accounting-equation">
                  <div className="accounting-equation-side">
                    <button type="button" onClick={() => setOverviewMetric("total_collection")}><span>Total collected</span><strong>{formatBDT(summary.data?.totalCollection)}</strong></button>
                    <span className="accounting-operator">+</span>
                    <button type="button" onClick={() => setOverviewMetric("total_due")}><span>EMI outstanding</span><strong>{formatBDT(summary.data?.totalDue)}</strong></button>
                  </div>
                  <span className="accounting-equals">=</span>
                  <div className="accounting-equation-side accounting-equation-side-wide">
                    <button type="button" onClick={() => setOverviewMetric("total_sales")}><span>Product sales</span><strong>{formatBDT(summary.data?.totalSales)}</strong></button>
                    <span className="accounting-operator">+</span>
                    <button type="button" onClick={() => setOverviewMetric("finance_charge")}><span>Finance charge</span><strong>{formatBDT(summary.data?.emiFinanceCharge)}</strong></button>
                    <span className="accounting-operator">+</span>
                    <button type="button" onClick={() => setOverviewMetric("delivery_collection")}><span>Delivery</span><strong>{formatBDT(summary.data?.deliveryCollection)}</strong></button>
                    <span className="accounting-operator">+</span>
                    <button type="button" onClick={() => setOverviewMetric("late_fees")}><span>Late fees</span><strong>{formatBDT(summary.data?.lateFeesAssessed)}</strong></button>
                  </div>
                </div>
                {Math.abs(Number(summary.data?.accountingDifference || 0)) >= 0.01 && (
                  <p className="form-error">Accounting difference: {formatBDT(summary.data?.accountingDifference)}. Open the related figures to inspect the source records.</p>
                )}
              </section>

              <section className="panel">
                <h2>Business snapshot</h2>
                <div className="stats-grid">
                  <StatCard label="Cash order receipts" value={formatBDT(summary.data?.cashCollection)} caption="Includes delivery received" tone="green" onClick={() => setOverviewMetric("cash_collection")} />
                  <StatCard label="Delivery collected" value={formatBDT(summary.data?.deliveryCollection)} caption="Part of cash receipts" onClick={() => setOverviewMetric("delivery_collection")} />
                  <StatCard label="EMI collected" value={formatBDT(summary.data?.emiCollection)} caption="Down payments + installments" tone="purple" onClick={() => setOverviewMetric("emi_collection")} />
                  <StatCard label="Down payments" value={formatBDT(summary.data?.downPaymentCollection)} caption="Confirmed activation payments" tone="purple" onClick={() => setOverviewMetric("down_payments")} />
                  <StatCard label="Installments collected" value={formatBDT(summary.data?.installmentCollection)} caption="Monthly and advance payments" tone="green" onClick={() => setOverviewMetric("installments")} />
                  <StatCard label="Collected this month" value={formatBDT(summary.data?.monthlyCollection)} caption="Confirmed current-month receipts" tone="green" onClick={() => setOverviewMetric("monthly_collection")} />
                  <StatCard label="Upcoming EMI" value={formatBDT(summary.data?.upcomingDue)} caption="Not overdue yet" tone="red" onClick={() => setOverviewMetric("upcoming_due")} />
                  <StatCard label="Active loans" value={summary.data?.activeLoanCount ?? activeLoans.length} caption="Currently collecting EMI" tone="green" onClick={() => setOverviewMetric("active_loans")} />
                  <StatCard label="Pending EMI requests" value={summary.data?.requestedLoansCount ?? requestedCount} caption="Waiting for review" onClick={() => setOverviewMetric("pending_requests")} />
                  <StatCard label="Awaiting down payments" value={summary.data?.awaitingDownPaymentCount ?? approvedLoans.length} caption="Approved, not activated" tone="purple" onClick={() => setOverviewMetric("awaiting_down_payments")} />
                  <StatCard label="Ready for delivery" value={summary.data?.readyDeliveryCount ?? 0} caption="Payment condition satisfied" tone="green" onClick={() => setOverviewMetric("ready_delivery")} />
                  <StatCard label="Low-stock products" value={(summary.data?.lowStockProducts || []).length} caption="At or below alert level" onClick={() => setOverviewMetric("low_stock")} />
                </div>
                {(summary.data?.lowStockProducts || []).length > 0 && (
                  <div className="list-stack">
                    {(summary.data?.lowStockProducts || []).slice(0, 5).map((product) => (
                      <button type="button" className="list-row overview-list-link" key={product._id} onClick={() => setOverviewMetric("low_stock")}>
                        <div><strong>{product.name}</strong><span>Stock {product.stock} | Alert at {product.lowStockThreshold}</span></div>
                        <span className="badge overdue">Low stock</span>
                      </button>
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
                  <p>Review EMI applications, approve eligible buyers, and monitor approved requests waiting for their Stripe down payment.</p>
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
                    {reviewLoans.length === 0 ? (
                      <tr><td colSpan="8" style={{ textAlign: "center", color: "#888" }}>No online EMI requests pending.</td></tr>
                    ) : (
                      reviewLoans.map((loan) => {
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
                              {loan.status === "requested" ? (
                                <>
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
                                </>
                              ) : (
                                <span className="badge pending">Awaiting Stripe down payment</span>
                              )}
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
                  <thead><tr><th>Order</th><th>Buyer</th><th>Seller total</th><th>Payment</th><th>Delivery state</th><th>Address</th><th>Linked EMI</th><th>Actions</th></tr></thead>
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
                          <td>
                            {getDeliveryState(order) === "ready" ? (
                              <span className="badge active">Ready for delivery</span>
                            ) : getDeliveryState(order) === "waiting_payment" ? (
                              <span className="badge pending">Waiting for down payment</span>
                            ) : (
                              <StatusBadge status={getDeliveryState(order)} />
                            )}
                          </td>
                          <td>{order.shippingAddress?.line1}, {order.shippingAddress?.city}</td>
                          <td>{(order.items || []).some((item) => item.loanId) ? "Yes" : "No"}</td>
                          <td className="table-action-cell">
                            <Link className="button tiny" to={`/orders/${order._id}`}>Details</Link>
                            {buyerProfilePath(order.buyerId) && <Link className="button tiny secondary" to={buyerProfilePath(order.buyerId)}>Buyer</Link>}
                            {order.fulfillmentStatus === "pending" && (
                              <button className="button tiny" disabled={!isOrderReadyForFulfillment(order)} onClick={() => updateOrderStatus.mutate({ orderId: order._id, fulfillmentStatus: "confirmed" })}>Confirm</button>
                            )}
                            {["confirmed", "processing"].includes(order.fulfillmentStatus) && isOrderReadyForFulfillment(order) && (
                              <button className="button tiny" onClick={() => updateOrderStatus.mutate({ orderId: order._id, fulfillmentStatus: "shipped" })}>Ship</button>
                            )}
                            {order.fulfillmentStatus === "shipped" && isOrderReadyForFulfillment(order) && (
                              <button className="button tiny" onClick={() => updateOrderStatus.mutate({ orderId: order._id, fulfillmentStatus: "delivered" })}>Deliver</button>
                            )}
                            {!isOrderReadyForFulfillment(order) && <small className="table-subtext">Waiting for payment</small>}
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
                            <div className="identity-cell">
                              <ProtectedImage
                                src={doc.buyerProfile?.profilePhoto?.downloadUrl}
                                alt={doc.userId?.name || "Buyer"}
                                className="avatar-image"
                                fallback={<div className="avatar-placeholder">{doc.userId?.name?.slice(0, 1) || "B"}</div>}
                              />
                              <div>
                                {buyerProfilePath(doc.userId) ? (
                                  <Link className="inline-profile-link" to={buyerProfilePath(doc.userId)}>{doc.userId?.name || "Buyer"}</Link>
                                ) : (
                                  doc.userId?.name
                                )}
                                <br /><span style={{ fontSize: "0.85rem", color: "#888" }}>{doc.userId?.email}</span>
                              </div>
                            </div>
                          </td>
                          <td>{formatKycType(doc.type)}</td>
                          <td>
                            {(doc.files || []).map((file) => (
                              <div key={file.filename || file.downloadUrl}>
                                <ProtectedDocumentViewer file={file} label={file.originalName || formatKycType(doc.type)} />
                              </div>
                            ))}
                            {doc.selfie && (
                              <div><ProtectedDocumentViewer file={doc.selfie} label="Selfie" /></div>
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
                  <thead><tr><th>Receipt</th><th>Buyer</th><th>Type</th><th>Method</th><th>Reference</th><th>Amount</th><th>Date</th><th>Status</th><th>Action</th></tr></thead>
                  <tbody>
                    {(payments.data || []).length === 0 ? (
                      <tr><td colSpan="9" style={{ textAlign: "center", color: "#888" }}>No confirmed payment history found</td></tr>
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
                          <td>{formatPaymentType(payment.transactionType)}</td>
                          <td>{String(payment.method || "—").replaceAll("_", " ")}</td>
                          <td>{payment.loanId?._id || payment.loanId || payment.orderId?.orderNo || payment.orderId || "—"}</td>
                          <td>BDT {payment.amount}</td>
                          <td>{dayjs(payment.paymentDate).format("DD MMM YYYY")}</td>
                          <td><StatusBadge status={payment.status} /></td>
                          <td className="table-action-cell">
                            <button className="button tiny" onClick={() => openProtectedFile(`/payments/${payment._id}/receipt`)}>Download PDF</button>
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
            <section className="reports-page">
              <div className="page-title">
                <div>
                  <h2>Seller reports</h2>
                  <p>Business performance, collection, portfolio, fulfillment, and risk records.</p>
                </div>
                <button className="button secondary" onClick={refreshData}><RefreshCcw size={16} /> Refresh reports</button>
              </div>
              <div className="stats-grid">
                <StatCard label="Recognized sales" value={reportOverviewValue(summary.data?.totalSales)} caption="Cash product value + EMI principal" tone="green" />
                <StatCard label="Confirmed collections" value={reportOverviewValue(summary.data?.totalCollection)} caption="Cash, down payments, and installments" tone="purple" />
                <StatCard label="EMI outstanding" value={reportOverviewValue(summary.data?.totalDue)} caption="Open schedule balances" />
                <StatCard label="Overdue exposure" value={reportOverviewValue(summary.data?.overdueAmount)} caption={summary.isLoading ? "Loading overdue records" : `${summary.data?.overdueCount || 0} overdue installments`} tone="red" />
              </div>

              <section className="panel report-builder">
                <div className="section-heading-row">
                  <div>
                    <h3><FileBarChart size={18} /> Report builder</h3>
                    <p>{reportPreview.data?.description || "Select a report and reporting period."}</p>
                  </div>
                  <div className="button-row">
                    <button
                      type="button"
                      className="button secondary"
                      disabled={Boolean(reportExporting) || reportRangeInvalid}
                      onClick={() => exportReport("excel")}
                    >
                      <FileSpreadsheet size={16} /> {reportExporting === "excel" ? "Generating..." : "Excel"}
                    </button>
                    <button
                      type="button"
                      className="button"
                      disabled={Boolean(reportExporting) || reportRangeInvalid}
                      onClick={() => exportReport("pdf")}
                    >
                      <FileText size={16} /> {reportExporting === "pdf" ? "Generating..." : "PDF"}
                    </button>
                  </div>
                </div>

                <div className="report-controls">
                  <label>Report type
                    <select value={reportType} onChange={(event) => setReportType(event.target.value)}>
                      {reportTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  <label>From date
                    <input type="date" value={reportDates.from} onChange={(event) => setReportDates({ ...reportDates, from: event.target.value })} />
                  </label>
                  <label>To date
                    <input type="date" value={reportDates.to} onChange={(event) => setReportDates({ ...reportDates, to: event.target.value })} />
                  </label>
                  <div className="report-period-control">
                    <span>Period</span>
                    <div className="segmented report-period-options">
                      <button type="button" className={!reportDates.from && !reportDates.to ? "active" : ""} onClick={() => setReportPeriod("all")}>All time</button>
                      <button
                        type="button"
                        className={reportDates.from === dayjs().startOf("month").format("YYYY-MM-DD") && reportDates.to === dayjs().format("YYYY-MM-DD") ? "active" : ""}
                        onClick={() => setReportPeriod("month")}
                      >
                        This month
                      </button>
                      <button
                        type="button"
                        className={reportDates.from === dayjs().startOf("year").format("YYYY-MM-DD") && reportDates.to === dayjs().format("YYYY-MM-DD") ? "active" : ""}
                        onClick={() => setReportPeriod("year")}
                      >
                        This year
                      </button>
                    </div>
                  </div>
                </div>

                {reportRangeInvalid && <div className="notice warning">The start date must be before or equal to the end date.</div>}

                {!reportRangeInvalid && (
                  <div className="report-summary-strip">
                    {(reportPreview.data?.summaries || []).map((item) => (
                      <div key={item.label}>
                        <span>{item.label}</span>
                        <strong>{item.money ? formatBDT(item.value) : Number(item.value || 0).toLocaleString("en-BD")}</strong>
                      </div>
                    ))}
                  </div>
                )}

                <div className="report-preview-heading">
                  <div>
                    <h3>{reportPreview.data?.title || "Report preview"}</h3>
                    <span>
                      <CalendarRange size={15} />
                      {reportDates.from || reportDates.to
                        ? `${reportDates.from ? dayjs(reportDates.from).format("DD MMM YYYY") : "Beginning"} to ${reportDates.to ? dayjs(reportDates.to).format("DD MMM YYYY") : "Today"}`
                        : "All available records"}
                    </span>
                  </div>
                  <span>{reportPreview.data?.count || 0} records</span>
                </div>

                {reportPreview.isLoading ? (
                  <div className="report-empty-state">Preparing report preview...</div>
                ) : reportPreview.isError ? (
                  <div className="error">{reportPreview.error?.response?.data?.message || "Unable to load report preview."}</div>
                ) : (
                  <div className="table-wrap">
                    <table className="report-preview-table">
                      <thead>
                        <tr>{(reportPreview.data?.columns || []).map((column) => <th key={column.key}>{column.label}</th>)}</tr>
                      </thead>
                      <tbody>
                        {(reportPreview.data?.rows || []).length === 0 ? (
                          <tr><td className="report-table-empty" colSpan={Math.max(reportPreview.data?.columns?.length || 1, 1)}>No records match this reporting period.</td></tr>
                        ) : (
                          (reportPreview.data?.rows || []).slice(0, 50).map((row, rowIndex) => (
                            <tr key={row.id || `${reportType}-${rowIndex}`}>
                              {(reportPreview.data?.columns || []).map((column) => (
                                <td key={column.key} className={column.align === "right" ? "numeric-cell" : ""}>
                                  {column.format === "status"
                                    ? <StatusBadge status={row[column.key]} />
                                    : formatReportCell(row[column.key], column.format)}
                                </td>
                              ))}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="report-basis">
                  <div>
                    <strong>Reporting basis</strong>
                    <span>{reportPreview.data?.basis || "Confirmed and seller-scoped records."}</span>
                  </div>
                  <span>{(reportPreview.data?.rows || []).length > 50 ? "Showing first 50 rows. Downloads include up to 1,000 records." : "Preview and downloads use the same report data."}</span>
                </div>
              </section>

              <div className="report-secondary-grid">
                <section className="panel">
                  <div className="section-heading-row">
                    <div>
                      <h3>Payment method split</h3>
                      <p>Confirmed collections within the selected period.</p>
                    </div>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Method</th><th>Transactions</th><th>Collected</th><th>Share</th></tr></thead>
                      <tbody>
                        {(paymentMethods.data || []).length === 0 ? (
                          <tr><td className="report-table-empty" colSpan="4">No confirmed collections in this period.</td></tr>
                        ) : (
                          (paymentMethods.data || []).map((row) => {
                            const methodTotal = (paymentMethods.data || []).reduce((sum, method) => sum + Number(method.amount || 0), 0);
                            return (
                              <tr key={row.method}>
                                <td>{String(row.method || "Unknown").replaceAll("_", " ")}</td>
                                <td>{row.count}</td>
                                <td>{formatBDT(row.amount)}</td>
                                <td>{methodTotal ? `${((Number(row.amount || 0) / methodTotal) * 100).toFixed(1)}%` : "0%"}</td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
                <section className="panel report-integrity-panel">
                  <h3>Report integrity</h3>
                  <dl>
                    <div><dt>Data scope</dt><dd>Current seller only</dd></div>
                    <div><dt>Currency</dt><dd>Bangladeshi taka (BDT)</dd></div>
                    <div><dt>Collection source</dt><dd>Confirmed transactions</dd></div>
                    <div><dt>PDF layout</dt><dd>A4 landscape with pagination</dd></div>
                    <div><dt>Generated by</dt><dd>Authenticated seller account</dd></div>
                  </dl>
                  <button type="button" className="button secondary report-download-secondary" onClick={() => exportReport("pdf")} disabled={Boolean(reportExporting) || reportRangeInvalid}>
                    <Download size={16} /> Download current report
                  </button>
                </section>
              </div>
            </section>
          )}

          {activeTab === "notifications" && <NotificationInbox />}
      {overviewMetric && (
        <div className="modal-backdrop" onClick={() => setOverviewMetric("")}>
          <section
            className="modal overview-detail-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="overview-detail-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <h2 id="overview-detail-title">{overviewMetricMeta[overviewMetric]?.title || "Overview details"}</h2>
                <p>{overviewMetricMeta[overviewMetric]?.description}</p>
              </div>
              <button type="button" className="modal-close-button" onClick={() => setOverviewMetric("")} aria-label="Close overview details" title="Close">
                <X size={18} />
              </button>
            </div>

            {overviewDetails.isLoading ? (
              <p className="hint">Loading related records...</p>
            ) : overviewDetails.isError ? (
              <p className="form-error">{overviewDetails.error?.response?.data?.message || "Unable to load overview details."}</p>
            ) : (
              <>
                <div className="overview-detail-summary">
                  <span><strong>{overviewDetails.data?.count || 0}</strong> records</span>
                  {overviewMetricMeta[overviewMetric]?.monetary && (
                    <span><strong>{formatBDT(overviewDetails.data?.total)}</strong> related amount</span>
                  )}
                </div>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Buyer</th><th>Details</th><th>Amount</th><th>Status</th><th aria-label="Open" /></tr></thead>
                    <tbody>
                      {(overviewDetails.data?.rows || []).length === 0 ? (
                        <tr><td colSpan="8" style={{ textAlign: "center", color: "#788783" }}>No related records found.</td></tr>
                      ) : (
                        (overviewDetails.data?.rows || []).map((row) => (
                          <tr key={row.id}>
                            <td>{row.date ? dayjs(row.date).format("DD MMM YYYY") : "—"}</td>
                            <td>{row.type || "—"}</td>
                            <td>{row.reference || "—"}</td>
                            <td>{row.buyer || "—"}</td>
                            <td>{row.description || "—"}</td>
                            <td>{formatBDT(row.amount)}</td>
                            <td><StatusBadge status={row.status || "recorded"} /></td>
                            <td>
                              {row.href ? (
                                <Link className="dashboard-icon-button" to={row.href} aria-label="Open related record" title="Open">
                                  <ArrowUpRight size={16} />
                                </Link>
                              ) : "—"}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        </div>
      )}
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
    </DashboardShell>
  );
}
