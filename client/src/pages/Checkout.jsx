import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../api/http";
import { clearCheckoutSelection, readCheckoutSelection } from "../utils/checkoutSelection.js";
import { formatBDT, getProductEmiTerms } from "../utils/productOptions.js";
import { notifyError, notifySuccess } from "../utils/toast.js";

export default function Checkout() {
  const navigate = useNavigate();
  const cart = useQuery({ queryKey: ["cart"], queryFn: async () => (await api.get("/cart")).data });
  const [checkoutSelection] = useState(() => readCheckoutSelection());
  const [couponCode, setCouponCode] = useState("");
  const [address, setAddress] = useState({ name: "", phone: "", line1: "", line2: "", city: "Sylhet", area: "", postalCode: "" });
  const [emiDrafts, setEmiDrafts] = useState({});
  const addressLabels = {
    name: "Full name",
    phone: "Phone number",
    line1: "Address line 1",
    line2: "Address line 2",
    city: "City",
    area: "Area",
    postalCode: "Postal code"
  };

  const createOrder = useMutation({
    mutationFn: async () => api.post("/orders/from-cart", {
      shippingAddress: address,
      couponCode,
      deliveryCharge: 80,
      itemIds: checkoutItems.map((item) => item._id),
      emi: {
        items: checkoutItems
          .filter((item) => item.selectedFinanceMode === "emi")
          .map((item) => ({
            cartItemId: item._id,
            downPayment: Number(emiDrafts[item._id]?.downPayment || getLineMinDownPayment(item)),
            tenureMonths: Number(emiDrafts[item._id]?.tenureMonths || getProductEmiTerms(item.productId).maxTenureMonths)
          }))
      }
    }),
    onSuccess: ({ data }) => {
      clearCheckoutSelection();
      notifySuccess(hasEmi ? "EMI request submitted. The product will be prepared after seller approval and Stripe down payment." : "Order placed successfully.");
      navigate(`/orders/${data._id}`);
    },
    onError: (err) => notifyError(err, "Checkout failed")
  });

  const items = cart.data?.items || [];
  const selectedIdSet = new Set(checkoutSelection.ids);
  const checkoutItems = checkoutSelection.exists ? items.filter((item) => selectedIdSet.has(item._id)) : items;
  const subtotal = checkoutItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const hasEmi = checkoutItems.some((item) => item.selectedFinanceMode === "emi");
  const checkoutItemsKey = checkoutItems.map((item) => `${item._id}:${item.quantity}:${item.selectedFinanceMode}`).join("|");

  useEffect(() => {
    setEmiDrafts((current) => {
      const next = { ...current };
      checkoutItems.filter((item) => item.selectedFinanceMode === "emi").forEach((item) => {
        const terms = getProductEmiTerms(item.productId);
        const minDownPayment = getLineMinDownPayment(item);
        next[item._id] = {
          downPayment: String(Math.max(Number(next[item._id]?.downPayment || 0), minDownPayment)),
          tenureMonths: String(Math.max(3, Math.min(Number(next[item._id]?.tenureMonths || 6), terms.maxTenureMonths)))
        };
      });
      return next;
    });
  }, [checkoutItemsKey]);

  function updateEmiDraft(itemId, patch) {
    setEmiDrafts((current) => ({ ...current, [itemId]: { ...(current[itemId] || {}), ...patch } }));
  }

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
              <label key={key}>{addressLabels[key]}
                <input value={address[key]} onChange={(e) => setAddress({ ...address, [key]: e.target.value })} />
              </label>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>Order summary</h2>
          <div className="list-stack">
            {checkoutItems.length === 0 && <p className="hint">No selected cart items found. Go back to cart and select products for checkout.</p>}
            {checkoutItems.map((item) => (
              <div className="list-row" key={item._id}>
                <div>
                  <strong>{item.productId?.name}</strong>
                  <span>{item.quantity} x BDT {item.unitPrice} | {item.selectedFinanceMode.toUpperCase()}</span>
                  <span className="color-chip"><span className="color-swatch" style={{ backgroundColor: item.selectedColorHex || "#64748b" }} /> {item.selectedColorName || "Default"}</span>
                </div>
                <strong>BDT {item.quantity * item.unitPrice}</strong>
              </div>
            ))}
          </div>
          {checkoutSelection.exists && items.length > checkoutItems.length && (
            <p className="hint">{items.length - checkoutItems.length} unchecked cart item{items.length - checkoutItems.length === 1 ? "" : "s"} will stay in your cart.</p>
          )}
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
          <div className="emi-line-list">
            {checkoutItems.filter((item) => item.selectedFinanceMode === "emi").map((item) => {
              const terms = getProductEmiTerms(item.productId);
              const minDownPayment = getLineMinDownPayment(item);
              const draft = emiDrafts[item._id] || {};
              return (
                <div className="emi-line-card" key={item._id}>
                  <div>
                    <strong>{item.productId?.name}</strong>
                    <p>{item.quantity} item{item.quantity === 1 ? "" : "s"} | Fixed {terms.interestRate}% {terms.interestType} | Max {terms.maxTenureMonths} months</p>
                  </div>
                  <div className="form-grid compact">
                    <label>Down payment
                      <input type="number" min={minDownPayment} value={draft.downPayment || minDownPayment} onChange={(e) => updateEmiDraft(item._id, { downPayment: e.target.value })} />
                    </label>
                    <label>Tenure months
                      <input type="number" min="3" max={terms.maxTenureMonths} value={draft.tenureMonths || Math.min(6, terms.maxTenureMonths)} onChange={(e) => updateEmiDraft(item._id, { tenureMonths: e.target.value })} />
                    </label>
                    <div className="readonly-field"><span>Minimum</span><strong>{formatBDT(minDownPayment)}</strong></div>
                    <div className="readonly-field"><span>Product total</span><strong>{formatBDT(item.quantity * item.unitPrice)}</strong></div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <button className="button" disabled={!checkoutItems.length || createOrder.isPending || !address.name || !address.phone || !address.line1} onClick={() => createOrder.mutate()}>
        {hasEmi ? "Submit EMI request" : "Place order"}
      </button>
      {createOrder.isError && <p className="form-error">{createOrder.error?.response?.data?.message || "Checkout failed"}</p>}
    </section>
  );
}

function getLineMinDownPayment(item) {
  return getProductEmiTerms(item.productId).minDownPayment * Number(item.quantity || 1);
}
