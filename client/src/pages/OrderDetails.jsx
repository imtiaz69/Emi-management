import { useEffect, useRef } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { api } from "../api/http";
import StatusBadge from "../components/StatusBadge.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { notifyError, notifyInfo, notifySuccess, notifyWarning } from "../utils/toast.js";

export default function OrderDetails() {
  const { id } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const handledStripeSessionRef = useRef("");
  const stripeParams = new URLSearchParams(location.search);
  const stripeStatus = stripeParams.get("stripe");
  const stripeSessionId = stripeParams.get("session_id");
  const order = useQuery({ queryKey: ["order", id], queryFn: async () => (await api.get(`/orders/${id}`)).data });
  const updateStatus = useMutation({
    mutationFn: async (fulfillmentStatus) => api.patch(`/orders/${id}/status`, { fulfillmentStatus }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["order", id] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      notifySuccess("Order status updated.");
    },
    onError: (err) => notifyError(err, "Unable to update order status.")
  });
  const createReturn = useMutation({
    mutationFn: async (sellerId) => api.post("/returns", { orderId: id, sellerId, reason: "Buyer requested return from order details" }),
    onSuccess: () => notifySuccess("Return request submitted."),
    onError: (err) => notifyError(err, "Unable to submit return request.")
  });
  const stripePayOrder = useMutation({
    mutationFn: async () => api.post("/payments/stripe/create-order-checkout-session", { orderId: id }),
    onSuccess: ({ data }) => {
      notifyInfo("Redirecting to Stripe for order payment.");
      window.location.href = data.url;
    },
    onError: (err) => notifyError(err, "Unable to start Stripe order payment.")
  });
  const confirmStripeOrder = useMutation({
    mutationFn: async (sessionId) => api.post("/payments/stripe/confirm-checkout-session", { sessionId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["order", id] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["buyer-orders"] });
      notifySuccess("Stripe order payment recorded successfully.");
      clearStripeReturnParams();
    },
    onError: (err) => {
      notifyError(err, "Unable to record Stripe order payment.");
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

  useEffect(() => {
    const stripeReturnKey = `${stripeStatus || ""}:${stripeSessionId || ""}`;
    if (!stripeStatus || handledStripeSessionRef.current === stripeReturnKey) return;

    if (stripeStatus === "cancel") {
      handledStripeSessionRef.current = stripeReturnKey;
      notifyWarning("Stripe payment was cancelled. Your order is still unpaid.");
      clearStripeReturnParams();
      return;
    }
    if (stripeStatus === "success" && stripeSessionId) {
      handledStripeSessionRef.current = stripeReturnKey;
      confirmStripeOrder.mutate(stripeSessionId);
    }
  }, [stripeSessionId, stripeStatus]);

  const data = order.data;
  if (order.isLoading) return <section className="dashboard"><div className="panel">Loading order...</div></section>;
  if (!data) return <section className="dashboard"><div className="panel">Order not found.</div></section>;
  const canPayWithStripe = user?.role === "buyer" && data.paymentMode === "cash" && data.paymentStatus === "unpaid";

  return (
    <section className="dashboard">
      <div className="page-title">
        <div>
          <h1>{data.orderNo}</h1>
          <p>Placed {dayjs(data.createdAt).format("DD MMM YYYY")}</p>
        </div>
        <Link className="button secondary" to="/orders">Back to orders</Link>
      </div>

      <div className="stats-grid">
        <div className="stat-card"><span>Total</span><strong>BDT {data.total}</strong></div>
        <div className="stat-card green"><span>Payment</span><strong>{data.paymentStatus}</strong></div>
        <div className="stat-card purple"><span>Fulfillment</span><strong>{data.fulfillmentStatus}</strong></div>
      </div>

      <section className="panel">
        <h2>Items</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Product</th><th>Color</th><th>Mode</th><th>Qty</th><th>Total</th><th>Status</th><th>Loan</th></tr></thead>
            <tbody>
              {(data.items || []).map((item) => (
                <tr key={item._id}>
                  <td>{item.name}</td>
                  <td><span className="color-chip"><span className="color-swatch" style={{ backgroundColor: item.selectedColorHex || "#64748b" }} /> {item.selectedColorName || "Default"}</span></td>
                  <td>{item.financeMode.toUpperCase()}</td>
                  <td>{item.quantity}</td>
                  <td>BDT {item.totalPrice}</td>
                  <td><StatusBadge status={item.fulfillmentStatus} /></td>
                  <td>{item.loanId ? <Link to={`/loans/${item.loanId._id || item.loanId}`}>View loan</Link> : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="work-grid">
        <section className="panel">
          <h2>Shipping address</h2>
          <p>{data.shippingAddress?.name}</p>
          <p>{data.shippingAddress?.phone}</p>
          <p>{data.shippingAddress?.line1}, {data.shippingAddress?.city}</p>
        </section>
        <section className="panel">
          <h2>Actions</h2>
          {user?.role === "seller" && (
            <div className="button-row">
              <button className="button tiny" onClick={() => updateStatus.mutate("processing")}>Processing</button>
              <button className="button tiny" onClick={() => updateStatus.mutate("shipped")}>Shipped</button>
              <button className="button tiny" onClick={() => updateStatus.mutate("delivered")}>Delivered</button>
            </div>
          )}
          {user?.role === "buyer" && (
            <div className="button-row">
              {canPayWithStripe && (
                <button className="button tiny" disabled={stripePayOrder.isPending} onClick={() => stripePayOrder.mutate()}>
                  Pay with Stripe
                </button>
              )}
              {[...new Set((data.items || []).map((item) => item.sellerId))].map((sellerId) => (
                <button className="button tiny secondary" key={sellerId} onClick={() => createReturn.mutate(sellerId)}>Request return</button>
              ))}
            </div>
          )}
          {canPayWithStripe && <p className="hint">Stripe test card: 4242 4242 4242 4242, any future expiry, any CVC.</p>}
          {stripePayOrder.isError && <p className="form-error">{stripePayOrder.error?.response?.data?.message || "Unable to start Stripe order payment"}</p>}
          {confirmStripeOrder.isError && <p className="form-error">{confirmStripeOrder.error?.response?.data?.message || "Unable to record Stripe order payment"}</p>}
        </section>
      </div>
    </section>
  );
}
