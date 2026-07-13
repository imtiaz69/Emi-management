import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Heart, Search, ShoppingBag, Store } from "lucide-react";
import { api } from "../api/http";
import { useAuth } from "../context/AuthContext.jsx";
import { formatBDT, getProductColors, getProductEmiTerms } from "../utils/productOptions.js";
import { notifyError, notifySuccess } from "../utils/toast.js";

export default function Marketplace() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({ q: "", category: "", sellerId: "", minPrice: "", maxPrice: "", sort: "newest" });
  const [selected, setSelected] = useState(null);
  const [request, setRequest] = useState({ downPayment: "0", tenureMonths: "6", selectedColorName: "" });
  const products = useQuery({ queryKey: ["marketplace", filters], queryFn: async () => (await api.get("/products", { params: filters })).data });
  const filterMeta = useQuery({ queryKey: ["product-filter-meta"], queryFn: async () => (await api.get("/products/meta/filters")).data });
  const addWishlist = useMutation({
    mutationFn: async (productId) => api.post("/wishlist", { productId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wishlist"] });
      notifySuccess("Product added to wishlist.");
    },
    onError: (err) => notifyError(err, "Unable to add product to wishlist.")
  });

  const requestLoan = useMutation({
    mutationFn: async () =>
      api.post("/loans/requests", {
        sellerId: selected.sellerId._id || selected.sellerId,
        productId: selected._id,
        principal: selected.price,
        downPayment: Number(request.downPayment),
        tenureMonths: Number(request.tenureMonths),
        selectedColorName: request.selectedColorName
      }),
    onSuccess: () => {
      setSelected(null);
      queryClient.invalidateQueries({ queryKey: ["buyer-loans"] });
      notifySuccess("EMI request sent to seller.");
    },
    onError: (err) => notifyError(err, "Unable to send EMI request.")
  });

  function sellerProfileId(product) {
    return product.sellerId?._id || product.sellerId;
  }

  function openQuickEmi(product) {
    const terms = getProductEmiTerms(product);
    const colors = getProductColors(product);
    setRequest({
      downPayment: String(terms.minDownPayment || 0),
      tenureMonths: String(Math.min(6, terms.maxTenureMonths || 6)),
      selectedColorName: colors[0]?.name || ""
    });
    setSelected(product);
  }

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
            {sellerProfileId(product) && (
              <Link className="seller-mini-link" to={`/stores/${sellerProfileId(product)}`}>
                <Store size={14} /> {product.sellerId?.name || "Seller store"}
              </Link>
            )}
            <h2>{product.name}</h2>
            <p>{product.description || "EMI-ready product from a local seller."}</p>
            <div className="product-meta">
              <strong>BDT {product.price}</strong>
              <span>{product.stock} in stock</span>
            </div>
            <div className="button-row">
              <Link className="button" to={`/products/${product._id}`}>View details</Link>
              <button
                className="button secondary wishlist-heart-button"
                title="Add to wishlist"
                aria-label={`Add ${product.name} to wishlist`}
                disabled={!user || user.role !== "buyer" || addWishlist.isPending}
                onClick={() => addWishlist.mutate(product._id)}
              >
                <Heart size={17} />
              </button>
              <button className="button secondary" disabled={!user || user.role !== "buyer" || !product.emiAvailable} onClick={() => openQuickEmi(product)}>
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
            <div className="notice success">
              Seller terms: {getProductEmiTerms(selected).interestRate}% {getProductEmiTerms(selected).interestType} interest, minimum down payment {formatBDT(getProductEmiTerms(selected).minDownPayment)}, maximum {getProductEmiTerms(selected).maxTenureMonths} months.
            </div>
            <div className="color-choice-block">
              <strong>Color</strong>
              <div className="color-choice-row">
                {getProductColors(selected).map((color) => (
                  <button
                    type="button"
                    className={`color-choice ${request.selectedColorName === color.name ? "active" : ""}`}
                    key={color.name}
                    onClick={() => setRequest({ ...request, selectedColorName: color.name })}
                  >
                    <span className="color-swatch" style={{ backgroundColor: color.hex }} />
                    {color.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="form-grid compact">
              <label>Down payment<input type="number" min={getProductEmiTerms(selected).minDownPayment} value={request.downPayment} onChange={(e) => setRequest({ ...request, downPayment: e.target.value })} /></label>
              <label>Tenure<input type="number" min="3" max={getProductEmiTerms(selected).maxTenureMonths} value={request.tenureMonths} onChange={(e) => setRequest({ ...request, tenureMonths: e.target.value })} /></label>
            </div>
            <button className="button" disabled={requestLoan.isPending}>Send request</button>
          </form>
        </div>
      )}
    </section>
  );
}
