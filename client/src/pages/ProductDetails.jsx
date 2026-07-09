import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Heart, ShoppingCart, Star } from "lucide-react";
import { api } from "../api/http";
import { useAuth } from "../context/AuthContext.jsx";

export default function ProductDetails() {
  const { id } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [financeMode, setFinanceMode] = useState("cash");
  const [quantity, setQuantity] = useState(1);
  const [emiForm, setEmiForm] = useState({ downPayment: "1000", interestRate: "12", tenureMonths: "6", interestType: "flat" });
  const [reviewForm, setReviewForm] = useState({ rating: 5, comment: "" });

  const productQuery = useQuery({ queryKey: ["product", id], queryFn: async () => (await api.get(`/products/${id}`)).data });
  const reviewsQuery = useQuery({ queryKey: ["reviews", id], queryFn: async () => (await api.get(`/reviews/product/${id}`)).data });
  const product = productQuery.data?.product;
  const related = productQuery.data?.related || [];

  const emiPreview = useQuery({
    queryKey: ["emi-preview", id, emiForm, product?.price],
    queryFn: async () => (await api.post("/loans/preview", {
      principal: product.price,
      downPayment: Number(emiForm.downPayment || 0),
      interestRate: Number(emiForm.interestRate || 0),
      tenureMonths: Number(emiForm.tenureMonths || 6),
      interestType: emiForm.interestType
    })).data,
    enabled: Boolean(product?.emiAvailable)
  });

  const addToCart = useMutation({
    mutationFn: async () => api.post("/cart/items", { productId: id, quantity, selectedFinanceMode: financeMode }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cart"] });
      alert("Added to cart.");
    }
  });

  const addWishlist = useMutation({
    mutationFn: async () => api.post("/wishlist", { productId: id }),
    onSuccess: () => alert("Added to wishlist.")
  });

  const addReview = useMutation({
    mutationFn: async () => api.post("/reviews", { productId: id, ...reviewForm }),
    onSuccess: () => {
      setReviewForm({ rating: 5, comment: "" });
      queryClient.invalidateQueries({ queryKey: ["reviews", id] });
    }
  });

  const monthlyEmi = useMemo(() => {
    const schedule = emiPreview.data?.schedule || [];
    return schedule[0]?.amountDue || 0;
  }, [emiPreview.data]);

  if (productQuery.isLoading) return <section className="dashboard"><div className="panel">Loading product...</div></section>;
  if (!product) return <section className="dashboard"><div className="panel">Product not found.</div></section>;

  return (
    <section className="dashboard">
      <div className="product-detail-layout">
        <section className="panel">
          {product.images?.[0]?.path ? (
            <img className="product-detail-image" src={product.images[0].path} alt={product.name} />
          ) : (
            <div className="product-detail-placeholder"><ShoppingCart size={46} /></div>
          )}
          <div className="image-preview-row">
            {(product.images || []).slice(1).map((image) => (
              <div className="image-preview" key={image.path}><img src={image.path} alt={product.name} /></div>
            ))}
          </div>
        </section>

        <section className="panel">
          <span className="badge active">{product.category}</span>
          <h1>{product.name}</h1>
          <p>{product.description || "No description added yet."}</p>
          <div className="product-meta">
            <strong>BDT {Number(product.price).toLocaleString("en-BD")}</strong>
            <span>{product.stock} available</span>
          </div>
          <div className="form-grid compact">
            <label>Quantity
              <input type="number" min="1" max={product.stock} value={quantity} onChange={(e) => setQuantity(Number(e.target.value || 1))} />
            </label>
            <label>Payment option
              <select value={financeMode} onChange={(e) => setFinanceMode(e.target.value)}>
                <option value="cash">Cash checkout</option>
                {product.emiAvailable && <option value="emi">EMI checkout</option>}
              </select>
            </label>
          </div>
          <div className="button-row">
            <button className="button" disabled={!user || user.role !== "buyer" || addToCart.isPending} onClick={() => addToCart.mutate()}>
              <ShoppingCart size={16} /> Add to cart
            </button>
            <button className="button secondary" disabled={!user || user.role !== "buyer"} onClick={() => addWishlist.mutate()}>
              <Heart size={16} /> Wishlist
            </button>
          </div>
          {!user && <p className="hint">Log in as a buyer to add this product to cart.</p>}
        </section>
      </div>

      {product.emiAvailable && (
        <section className="panel">
          <h2>EMI preview</h2>
          <div className="form-grid compact">
            <label>Down payment<input type="number" value={emiForm.downPayment} onChange={(e) => setEmiForm({ ...emiForm, downPayment: e.target.value })} /></label>
            <label>Interest rate %<input type="number" value={emiForm.interestRate} onChange={(e) => setEmiForm({ ...emiForm, interestRate: e.target.value })} /></label>
            <label>Tenure months<input type="number" min="3" max="60" value={emiForm.tenureMonths} onChange={(e) => setEmiForm({ ...emiForm, tenureMonths: e.target.value })} /></label>
            <label>Interest type<select value={emiForm.interestType} onChange={(e) => setEmiForm({ ...emiForm, interestType: e.target.value })}><option value="flat">Flat</option><option value="reducing">Reducing</option><option value="zero">Zero</option></select></label>
          </div>
          <div className="stats-grid">
            <div className="stat-card"><span>Monthly EMI</span><strong>BDT {Math.round(monthlyEmi).toLocaleString("en-BD")}</strong></div>
            <div className="stat-card green"><span>Total payable</span><strong>BDT {Math.round(emiPreview.data?.totalPayable || 0).toLocaleString("en-BD")}</strong></div>
            <div className="stat-card purple"><span>Financed</span><strong>BDT {Math.round(emiPreview.data?.financed || 0).toLocaleString("en-BD")}</strong></div>
          </div>
        </section>
      )}

      <div className="work-grid">
        <section className="panel">
          <h2>Seller</h2>
          <p>{product.sellerId?.name || "Seller"}</p>
          <p>{product.sellerId?.phone || product.sellerId?.email || ""}</p>
        </section>
        <section className="panel">
          <h2>Product details</h2>
          <p>Brand: {product.brand || "-"}</p>
          <p>SKU: {product.sku || "-"}</p>
          <p>Warranty: {product.warranty || "-"}</p>
        </section>
      </div>

      <section className="panel">
        <h2>Reviews</h2>
        {user?.role === "buyer" && (
          <div className="form-grid compact">
            <label>Rating<input type="number" min="1" max="5" value={reviewForm.rating} onChange={(e) => setReviewForm({ ...reviewForm, rating: Number(e.target.value) })} /></label>
            <label>Comment<input value={reviewForm.comment} onChange={(e) => setReviewForm({ ...reviewForm, comment: e.target.value })} /></label>
            <button className="button" onClick={() => addReview.mutate()}>Submit review</button>
          </div>
        )}
        <div className="list-stack">
          {(reviewsQuery.data || []).map((review) => (
            <div className="list-row" key={review._id}>
              <div><strong>{review.buyerId?.name || "Buyer"}</strong><span>{review.comment}</span></div>
              <span><Star size={14} /> {review.rating}</span>
            </div>
          ))}
          {(reviewsQuery.data || []).length === 0 && <p className="hint">No reviews yet.</p>}
        </div>
      </section>

      {related.length > 0 && (
        <section className="panel">
          <h2>Related products</h2>
          <div className="product-grid">
            {related.map((item) => (
              <article className="product-card" key={item._id}>
                <h2>{item.name}</h2>
                <p>BDT {item.price}</p>
                <Link className="button small" to={`/products/${item._id}`}>View details</Link>
              </article>
            ))}
          </div>
        </section>
      )}
    </section>
  );
}
