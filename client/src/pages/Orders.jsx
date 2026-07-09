import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { api } from "../api/http";
import StatusBadge from "../components/StatusBadge.jsx";
import { useAuth } from "../context/AuthContext.jsx";

export default function Orders() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const orders = useQuery({ queryKey: ["orders"], queryFn: async () => (await api.get("/orders")).data });
  const payOrder = useMutation({
    mutationFn: async (id) => api.patch(`/orders/${id}/pay-mock`, { method: "mock_gateway" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["orders"] })
  });
  const cancelOrder = useMutation({
    mutationFn: async (id) => api.patch(`/orders/${id}/cancel`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["orders"] })
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
                    {user?.role === "buyer" && order.paymentStatus === "unpaid" && <button className="button tiny" onClick={() => payOrder.mutate(order._id)}>Mock pay</button>}
                    {order.fulfillmentStatus !== "cancelled" && order.fulfillmentStatus !== "delivered" && <button className="button tiny danger" onClick={() => cancelOrder.mutate(order._id)}>Cancel</button>}
                  </td>
                </tr>
              ))}
              {(orders.data || []).length === 0 && <tr><td colSpan="6" style={{ textAlign: "center", color: "#888" }}>No orders found.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
