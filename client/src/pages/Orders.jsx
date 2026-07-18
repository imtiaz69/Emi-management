import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { api } from "../api/http";
import StatusBadge from "../components/StatusBadge.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { notifyError, notifyInfo, notifySuccess } from "../utils/toast.js";

export default function Orders() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const orders = useQuery({ queryKey: ["orders"], queryFn: async () => (await api.get("/orders")).data });
  const stripePayOrder = useMutation({
    mutationFn: async (id) => api.post("/payments/stripe/create-order-checkout-session", { orderId: id }),
    onSuccess: ({ data }) => {
      notifyInfo("Redirecting to Stripe for order payment.");
      window.location.href = data.url;
    },
    onError: (err) => notifyError(err, "Unable to start Stripe order payment.")
  });
  const cancelOrder = useMutation({
    mutationFn: async (id) => api.patch(`/orders/${id}/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      notifySuccess("Order cancelled successfully.");
    },
    onError: (err) => notifyError(err, "Unable to cancel order.")
  });

  return (
    <section className="dashboard">
      <div className="page-title">
        <div>
          <h1>{user?.role === "seller" ? "Seller Orders" : "My Orders"}</h1>
          <p>Track ecommerce checkout, payment, delivery, and linked EMI loan status.</p>
        </div>
      </div>

      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Order</th><th>Total</th><th>Payment</th><th>Fulfillment</th><th>Date</th><th>Action</th></tr></thead>
            <tbody>
              {(orders.data || []).map((order) => (
                <tr key={order._id}>
                  <td><Link to={`/orders/${order._id}`}>{order.orderNo}</Link></td>
                  <td>BDT {order.total}</td>
                  <td><StatusBadge status={order.paymentStatus} /></td>
                  <td><StatusBadge status={order.fulfillmentStatus} /></td>
                  <td>{dayjs(order.createdAt).format("DD MMM YYYY")}</td>
                  <td className="table-action-cell">
                    <Link className="button tiny" to={`/orders/${order._id}`}>Details</Link>
                    {user?.role === "buyer" && order.paymentMode === "cash" && order.paymentStatus === "unpaid" && (
                      <button className="button tiny" disabled={stripePayOrder.isPending} onClick={() => stripePayOrder.mutate(order._id)}>Pay</button>
                    )}
                    {order.fulfillmentStatus !== "cancelled" && order.fulfillmentStatus !== "delivered" && <button className="button tiny danger" onClick={() => cancelOrder.mutate(order._id)}>Cancel</button>}
                  </td>
                </tr>
              ))}
              {(orders.data || []).length === 0 && <tr><td colSpan="6" style={{ textAlign: "center", color: "#888" }}>No orders found.</td></tr>}
            </tbody>
          </table>
        </div>
        {stripePayOrder.isError && <p className="form-error">{stripePayOrder.error?.response?.data?.message || "Unable to start Stripe order payment"}</p>}
      </section>
    </section>
  );
}
