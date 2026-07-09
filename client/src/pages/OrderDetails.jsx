import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { api } from "../api/http";
import StatusBadge from "../components/StatusBadge.jsx";
import { useAuth } from "../context/AuthContext.jsx";

export default function OrderDetails() {
  const { id } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const order = useQuery({ queryKey: ["order", id], queryFn: async () => (await api.get(`/orders/${id}`)).data });
  const updateStatus = useMutation({
    mutationFn: async (fulfillmentStatus) => api.patch(`/orders/${id}/status`, { fulfillmentStatus }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["order", id] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    }
  });
  const createReturn = useMutation({
    mutationFn: async (sellerId) => api.post("/returns", { orderId: id, sellerId, reason: "Buyer requested return from order details" }),
    onSuccess: () => alert("Return request submitted.")
  });

  const data = order.data;
  if (order.isLoading) return <section className="dashboard"><div className="panel">Loading order...</div></section>;
  if (!data) return <section className="dashboard"><div className="panel">Order not found.</div></section>;

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
            <thead><tr><th>Product</th><th>Mode</th><th>Qty</th><th>Total</th><th>Status</th><th>Loan</th></tr></thead>
            <tbody>
              {(data.items || []).map((item) => (
                <tr key={item._id}>
                  <td>{item.name}</td>
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
              {[...new Set((data.items || []).map((item) => item.sellerId))].map((sellerId) => (
                <button className="button tiny secondary" key={sellerId} onClick={() => createReturn.mutate(sellerId)}>Request return</button>
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
