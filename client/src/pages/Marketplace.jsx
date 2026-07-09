import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, ShoppingBag } from "lucide-react";
import { api } from "../api/http";
import { useAuth } from "../context/AuthContext.jsx";

export default function Marketplace() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({ q: "", category: "", sellerId: "", minPrice: "", maxPrice: "", sort: "newest" });
  const [selected, setSelected] = useState(null);
  const [request, setRequest] = useState({ downPayment: "1000", interestRate: "12", tenureMonths: "6", interestType: "flat" });
  const products = useQuery({ queryKey: ["marketplace", filters], queryFn: async () => (await api.get("/products", { params: filters })).data });
  const filterMeta = useQuery({ queryKey: ["product-filter-meta"], queryFn: async () => (await api.get("/products/meta/filters")).data });

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
        <div className="search-box"><Search size={18} /><input placeholder="Search products" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} /></div>
      </div>

      <section className="panel">
        <div className="form-grid compact">
          <label>Category
            <select value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })}>
              <option value="">All categories</option>
              {(filterMeta.data?.categories || []).map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </label>
          <label>Seller
            <select value={filters.sellerId} onChange={(e) => setFilters({ ...filters, sellerId: e.target.value })}>
              <option value="">All sellers</option>
              {(filterMeta.data?.sellers || []).map((seller) => <option key={seller._id} value={seller._id}>{seller.name}</option>)}
            </select>
          </label>
          <label>Min price
            <input type="number" value={filters.minPrice} onChange={(e) => setFilters({ ...filters, minPrice: e.target.value })} placeholder="BDT" />
          </label>
          <label>Max price
            <input type="number" value={filters.maxPrice} onChange={(e) => setFilters({ ...filters, maxPrice: e.target.value })} placeholder="BDT" />
          </label>
          <label>Sort
            <select value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value })}>
              <option value="newest">Newest</option>
              <option value="price_asc">Price low to high</option>
              <option value="price_desc">Price high to low</option>
              <option value="popular">Popular/featured</option>
            </select>
          </label>
        </div>
      </section>

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
            <div className="button-row">
              <Link className="button" to={`/products/${product._id}`}>View details</Link>
              <button className="button secondary" disabled={!user || user.role !== "buyer" || !product.emiAvailable} onClick={() => setSelected(product)}>
                Quick EMI
              </button>
            </div>
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
