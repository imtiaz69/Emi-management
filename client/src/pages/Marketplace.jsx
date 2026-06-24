import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, ShoppingBag } from "lucide-react";
import { api } from "../api/http";
import { useAuth } from "../context/AuthContext.jsx";

export default function Marketplace() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState(null);
  const [request, setRequest] = useState({ downPayment: "1000", interestRate: "12", tenureMonths: "6", interestType: "flat" });
  const products = useQuery({ queryKey: ["marketplace", q], queryFn: async () => (await api.get("/products", { params: { q } })).data });

  const requestLoan = useMutation({
    mutationFn: async () =>
      api.post("/loans/requests", {
        sellerId: selected.sellerId._id || selected.sellerId,
        productId: selected._id,
        principal: selected.price,
        downPayment: Number(request.downPayment),
        interestRate: Number(request.interestRate),
        tenureMonths: Number(request.tenureMonths),
        interestType: request.interestType
      }),
    onSuccess: () => {
      setSelected(null);
      queryClient.invalidateQueries({ queryKey: ["buyer-loans"] });
      alert("EMI request sent to seller");
    }
  });

  return (
    <section className="dashboard">
      <div className="page-title">
        <div>
          <h1>Buyer Marketplace</h1>
          <p>Browse seller products and request EMI financing with a transparent payment preview.</p>
        </div>
        <div className="search-box"><Search size={18} /><input placeholder="Search products" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>

      <div className="product-grid">
        {(products.data || []).map((product) => (
          <article className="product-card" key={product._id}>
            {product.images?.[0]?.path ? (
              <img className="product-image" src={product.images[0].path} alt={product.name} />
            ) : (
              <div className="product-media"><ShoppingBag size={34} /></div>
            )}
            <h2>{product.name}</h2>
            <p>{product.description || "EMI-ready product from a local seller."}</p>
            <div className="product-meta">
              <strong>BDT {product.price}</strong>
              <span>{product.stock} in stock</span>
            </div>
            <button className="button" disabled={!user || user.role !== "buyer" || !product.emiAvailable} onClick={() => setSelected(product)}>
              Request EMI
            </button>
          </article>
        ))}
      </div>

      {selected && (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); requestLoan.mutate(); }}>
            <h2>Request EMI for {selected.name}</h2>
            <div className="form-grid compact">
              <label>Down payment<input type="number" value={request.downPayment} onChange={(e) => setRequest({ ...request, downPayment: e.target.value })} /></label>
              <label>Interest %<input type="number" value={request.interestRate} onChange={(e) => setRequest({ ...request, interestRate: e.target.value })} /></label>
              <label>Tenure<input type="number" min="3" max="60" value={request.tenureMonths} onChange={(e) => setRequest({ ...request, tenureMonths: e.target.value })} /></label>
              <label>Interest type<select value={request.interestType} onChange={(e) => setRequest({ ...request, interestType: e.target.value })}><option value="flat">Flat</option><option value="reducing">Reducing</option><option value="zero">Zero</option></select></label>
            </div>
            <button className="button" disabled={requestLoan.isPending}>Send request</button>
          </form>
        </div>
      )}
    </section>
  );
}
