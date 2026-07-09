import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShoppingCart, Trash2 } from "lucide-react";
import { api } from "../api/http";

export default function Cart() {
  const queryClient = useQueryClient();
  const cart = useQuery({ queryKey: ["cart"], queryFn: async () => (await api.get("/cart")).data });
  const updateItem = useMutation({
    mutationFn: async ({ itemId, payload }) => api.patch(`/cart/items/${itemId}`, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cart"] })
  });
  const removeItem = useMutation({
    mutationFn: async (itemId) => api.delete(`/cart/items/${itemId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cart"] })
  });

  const items = cart.data?.items || [];
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

  return (
    <section className="dashboard">
      <div className="page-title">
        <div>
          <h1>Shopping Cart</h1>
          <p>Choose cash or EMI for each item before checkout.</p>
        </div>
        <Link className="button secondary" to="/marketplace">Continue shopping</Link>
      </div>

      <section className="panel">
        {items.length === 0 ? (
          <div className="empty-state"><ShoppingCart size={34} /><p>Your cart is empty.</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Product</th><th>Mode</th><th>Qty</th><th>Price</th><th>Total</th><th></th></tr></thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item._id}>
                    <td>{item.productId?.name}</td>
                    <td>
                      <select value={item.selectedFinanceMode} onChange={(e) => updateItem.mutate({ itemId: item._id, payload: { selectedFinanceMode: e.target.value } })}>
                        <option value="cash">Cash</option>
                        {item.productId?.emiAvailable && <option value="emi">EMI</option>}
                      </select>
                    </td>
                    <td><input type="number" min="1" max={item.productId?.stock || 1} value={item.quantity} onChange={(e) => updateItem.mutate({ itemId: item._id, payload: { quantity: Number(e.target.value) } })} /></td>
                    <td>BDT {item.unitPrice}</td>
                    <td>BDT {item.quantity * item.unitPrice}</td>
                    <td><button className="button tiny danger" onClick={() => removeItem.mutate(item._id)}><Trash2 size={14} /> Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {items.length > 0 && (
        <section className="panel checkout-summary">
          <div>
            <span>Subtotal</span>
            <strong>BDT {subtotal.toLocaleString("en-BD")}</strong>
          </div>
          <Link className="button" to="/checkout">Checkout</Link>
        </section>
      )}
    </section>
  );
}
