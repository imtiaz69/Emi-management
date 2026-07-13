import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Heart, ShoppingCart, Star, Store, X } from "lucide-react";
import { api } from "../api/http";
import { useAuth } from "../context/AuthContext.jsx";
import { writeCheckoutSelection } from "../utils/checkoutSelection.js";
import { formatBDT, getProductColors, getProductEmiTerms } from "../utils/productOptions.js";
import { notifyError, notifySuccess } from "../utils/toast.js";

export default function ProductDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [financeMode, setFinanceMode] = useState("cash");
  const [quantity, setQuantity] = useState(1);
  const [selectedColorName, setSelectedColorName] = useState("");
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [emiForm, setEmiForm] = useState({ downPayment: "0", tenureMonths: "6" });
  const [reviewForm, setReviewForm] = useState({ rating: 5, comment: "" });

  const productQuery = useQuery({ queryKey: ["product", id], queryFn: async () => (await api.get(`/products/${id}`)).data });
  const reviewsQuery = useQuery({ queryKey: ["reviews", id], queryFn: async () => (await api.get(`/reviews/product/${id}`)).data });
  const product = productQuery.data?.product;
  const related = productQuery.data?.related || [];
  const productColors = useMemo(() => getProductColors(product), [product]);
  const emiTerms = useMemo(() => getProductEmiTerms(product), [product]);
  const minDownPayment = emiTerms.minDownPayment * Number(quantity || 1);
  const maxTenureMonths = emiTerms.maxTenureMonths;
  const productImages = product?.images || [];

  const emiPreview = useQuery({
    queryKey: ["emi-preview", id, emiForm, quantity, product?.price, emiTerms],
    queryFn: async () => (await api.post("/loans/preview", {
      principal: product.price * Number(quantity || 1),
      downPayment: Number(emiForm.downPayment || 0),
      interestRate: emiTerms.interestRate,
      tenureMonths: Number(emiForm.tenureMonths || 6),
      interestType: emiTerms.interestType
    })).data,
    enabled: Boolean(product?.emiAvailable)
  });

  const addToCart = useMutation({
    mutationFn: async () => api.post("/cart/items", { productId: id, quantity, selectedFinanceMode: financeMode, selectedColorName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cart"] });
      notifySuccess("Product added to cart.");
    },
    onError: (err) => notifyError(err, "Unable to add product to cart.")
  });

  const addWishlist = useMutation({
    mutationFn: async () => api.post("/wishlist", { productId: id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wishlist"] });
      notifySuccess("Product added to wishlist.");
    },
    onError: (err) => notifyError(err, "Unable to add product to wishlist.")
  });

  const buyNow = useMutation({
    mutationFn: async () => api.post("/cart/items", { productId: id, quantity, selectedFinanceMode: financeMode, selectedColorName, replaceExisting: true }),
    onSuccess: ({ data }) => {
      queryClient.invalidateQueries({ queryKey: ["cart"] });
      const targetItem = (data.items || []).find((item) => (item.productId?._id || item.productId) === id && item.selectedColorName === selectedColorName);
      if (targetItem?._id) writeCheckoutSelection([targetItem._id]);
      notifySuccess("Product ready for checkout.");
      navigate("/checkout");
    },
    onError: (err) => notifyError(err, "Unable to start checkout.")
  });

  const addReview = useMutation({
    mutationFn: async () => api.post("/reviews", { productId: id, ...reviewForm }),
    onSuccess: () => {
      setReviewForm({ rating: 5, comment: "" });
      queryClient.invalidateQueries({ queryKey: ["reviews", id] });
      notifySuccess("Review submitted successfully.");
    },
    onError: (err) => notifyError(err, "Unable to submit review.")
  });

  const monthlyEmi = useMemo(() => {
    const schedule = emiPreview.data?.schedule || [];
    return schedule[0]?.amountDue || 0;
  }, [emiPreview.data]);

  useEffect(() => {
    if (!product) return;
    const firstColor = getProductColors(product)[0];
    setSelectedColorName(firstColor.name);
    setActiveImageIndex(0);
    const terms = getProductEmiTerms(product);
    setEmiForm({
      downPayment: String(terms.minDownPayment || 0),
      tenureMonths: String(Math.min(6, terms.maxTenureMonths || 6))
    });
  }, [product?._id]);

  useEffect(() => {
    if (!product) return;
    setEmiForm((current) => ({
      downPayment: String(Math.max(Number(current.downPayment || 0), minDownPayment)),
      tenureMonths: String(Math.min(Number(current.tenureMonths || maxTenureMonths), maxTenureMonths))
    }));
  }, [minDownPayment, maxTenureMonths, product]);

  useEffect(() => {
    if (!galleryOpen) return undefined;
    function handleKeyDown(event) {
      if (event.key === "Escape") setGalleryOpen(false);
      if (event.key === "ArrowRight") showNextImage();
      if (event.key === "ArrowLeft") showPreviousImage();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [galleryOpen, productImages.length]);

  function showNextImage() {
    if (!productImages.length) return;
    setActiveImageIndex((index) => (index + 1) % productImages.length);
  }

  function showPreviousImage() {
    if (!productImages.length) return;
    setActiveImageIndex((index) => (index - 1 + productImages.length) % productImages.length);
  }

  if (productQuery.isLoading) return <section className="dashboard"><div className="panel">Loading product...</div></section>;
  if (!product) return <section className="dashboard"><div className="panel">Product not found.</div></section>;
  const sellerProfileId = product.sellerId?._id || product.sellerId;

  return (
    <section className="dashboard">
      <div className="product-detail-layout">
        <section className="panel">
          {productImages[activeImageIndex]?.path ? (
            <button className="product-detail-image-button" type="button" onClick={() => setGalleryOpen(true)}>
              <img className="product-detail-image" src={productImages[activeImageIndex].path} alt={product.name} />
            </button>
          ) : (
            <div className="product-detail-placeholder"><ShoppingCart size={46} /></div>
          )}
          <div className="image-preview-row">
            {productImages.map((image, index) => (
              <button className={`image-preview image-preview-button ${activeImageIndex === index ? "active" : ""}`} type="button" key={image.path} onClick={() => setActiveImageIndex(index)}>
                <img src={image.path} alt={product.name} />
              </button>
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
          <div className="color-choice-block">
            <strong>Color</strong>
            <div className="color-choice-row">
              {productColors.map((color) => (
                <button
                  className={`color-choice ${selectedColorName === color.name ? "active" : ""}`}
                  type="button"
                  key={color.name}
                  onClick={() => setSelectedColorName(color.name)}
                >
                  <span className="color-swatch" style={{ backgroundColor: color.hex }} />
                  {color.name}
                </button>
              ))}
            </div>
          </div>
          <div className="form-grid compact">
            <label>Quantity
              <input type="number" min="1" max={product.stock} value={quantity} onChange={(e) => setQuantity(Math.min(Math.max(Number(e.target.value || 1), 1), product.stock))} />
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
            <button className="button secondary" disabled={!user || user.role !== "buyer" || buyNow.isPending} onClick={() => buyNow.mutate()}>
              Buy now
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
            <label>Down payment<input type="number" min={minDownPayment} value={emiForm.downPayment} onChange={(e) => setEmiForm({ ...emiForm, downPayment: e.target.value })} /></label>
            <label>Tenure months<input type="number" min="3" max={maxTenureMonths} value={emiForm.tenureMonths} onChange={(e) => setEmiForm({ ...emiForm, tenureMonths: e.target.value })} /></label>
            <div className="readonly-field"><span>Fixed interest</span><strong>{emiTerms.interestRate}% {emiTerms.interestType}</strong></div>
            <div className="readonly-field"><span>Seller limit</span><strong>Min {formatBDT(minDownPayment)} / Max {maxTenureMonths} months</strong></div>
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
          {sellerProfileId && (
            <div className="button-row" style={{ marginTop: "14px" }}>
              <Link className="button secondary" to={`/stores/${sellerProfileId}`}><Store size={16} /> View store profile</Link>
            </div>
          )}
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

      {galleryOpen && productImages.length > 0 && (
        <div className="gallery-backdrop" onClick={() => setGalleryOpen(false)}>
          <button className="gallery-close" type="button" onClick={(event) => { event.stopPropagation(); setGalleryOpen(false); }} aria-label="Close image gallery"><X size={22} /></button>
          <button className="gallery-arrow left" type="button" onClick={(event) => { event.stopPropagation(); showPreviousImage(); }} aria-label="Previous image"><ChevronLeft size={30} /></button>
          <img className="gallery-image" src={productImages[activeImageIndex].path} alt={product.name} onClick={(event) => event.stopPropagation()} />
          <button className="gallery-arrow right" type="button" onClick={(event) => { event.stopPropagation(); showNextImage(); }} aria-label="Next image"><ChevronRight size={30} /></button>
          <div className="gallery-counter">{activeImageIndex + 1} / {productImages.length}</div>
        </div>
      )}
    </section>
  );
}
