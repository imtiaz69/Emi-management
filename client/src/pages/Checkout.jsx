import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../api/http";

export default function Checkout() {
  const navigate = useNavigate();
  const cart = useQuery({ queryKey: ["cart"], queryFn: async () => (await api.get("/cart")).data });
  const [couponCode, setCouponCode] = useState("");
  const [address, setAddress] = useState({ name: "", phone: "", line1: "", line2: "", city: "Sylhet", area: "", postalCode: "" });
  const [emi, setEmi] = useState({ downPayment: "1000", interestRate: "12", tenureMonths: "6", interestType: "flat" });

  const createOrder = useMutation({
    mutationFn: async () => api.post("/orders/from-cart", { shippingAddress: address, couponCode, deliveryCharge: 80, emi }),
    onSuccess: ({ data }) => navigate(`/orders/${data._id}`)
  });

  const items = cart.data?.items || [];
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const hasEmi = items.some((item) => item.selectedFinanceMode === "emi");

  return (
    <section className="dashboard">
      <div className="page-title">
        <div>
          <h1>Checkout</h1>
          <p>Confirm shipping information and EMI terms for selected items.</p>
        </div>
      </div>

      <div className="work-grid">
        <section className="panel">
          <h2>Shipping address</h2>
          <div className="form-grid">
            {Object.keys(address).map((key) => (
              <label key={key}>{key.replace(/([A-Z])/g, " $1")}
                <input value={address[key]} onChange={(e) => setAddress({ ...address, [key]: e.target.value })} />
              </label>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>Order summary</h2>
          <div className="list-stack">
            {items.map((item) => (
              <div className="list-row" key={item._id}>
                <div><strong>{item.productId?.name}</strong><span>{item.quantity} x BDT {item.unitPrice} | {item.selectedFinanceMode.toUpperCase()}</span></div>
                <strong>BDT {item.quantity * item.unitPrice}</strong>
              </div>
            ))}
          </div>
          <label>Coupon code<input value={couponCode} onChange={(e) => setCouponCode(e.target.value)} /></label>
          <div className="checkout-summary">
            <div><span>Subtotal</span><strong>BDT {subtotal.toLocaleString("en-BD")}</strong></div>
            <div><span>Delivery</span><strong>BDT 80</strong></div>
          </div>
        </section>
      </div>

      {hasEmi && (
        <section className="panel">
          <h2>EMI terms</h2>
          <div className="form-grid">
            <label>Down payment<input type="number" value={emi.downPayment} onChange={(e) => setEmi({ ...emi, downPayment: e.target.value })} /></label>
            <label>Interest rate %<input type="number" value={emi.interestRate} onChange={(e) => setEmi({ ...emi, interestRate: e.target.value })} /></label>
            <label>Tenure months<input type="number" min="3" max="60" value={emi.tenureMonths} onChange={(e) => setEmi({ ...emi, tenureMonths: e.target.value })} /></label>
            <label>Interest type<select value={emi.interestType} onChange={(e) => setEmi({ ...emi, interestType: e.target.value })}><option value="flat">Flat</option><option value="reducing">Reducing</option><option value="zero">Zero</option></select></label>
          </div>
        </section>
      )}

      <button className="button" disabled={!items.length || createOrder.isPending || !address.name || !address.phone || !address.line1} onClick={() => createOrder.mutate()}>
        Place order
      </button>
      {createOrder.isError && <p className="form-error">{createOrder.error?.response?.data?.message || "Checkout failed"}</p>}
    </section>
  );
}
