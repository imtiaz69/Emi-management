import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  Filter,
  Heart,
  RotateCcw,
  Search,
  ShoppingBag,
  Store,
  X
} from "lucide-react";
import { api, downloadUrl } from "../api/http";
import { useAuth } from "../context/AuthContext.jsx";
import { writeCheckoutSelection } from "../utils/checkoutSelection.js";
import { formatBDT, getProductColors, getProductEmiTerms } from "../utils/productOptions.js";
import { notifyError, notifySuccess } from "../utils/toast.js";

const CATEGORY_FAMILIES = [
  { key: "electronics", label: "Electronics & Devices", terms: ["electronics", "mobile", "phone", "laptop", "computer", "tablet", "television", "tv", "camera", "audio", "gaming", "accessories"] },
  { key: "home", label: "Home & Living", terms: ["furniture", "home", "appliance", "kitchen", "decor", "office", "garden"] },
  { key: "fashion", label: "Fashion & Lifestyle", terms: ["fashion", "clothing", "shoe", "watch", "jewelry", "bag", "lifestyle"] },
  { key: "health", label: "Health & Beauty", terms: ["health", "beauty", "personal care", "fitness", "medical"] },
  { key: "sports", label: "Sports & Outdoors", terms: ["sport", "outdoor", "bicycle", "travel"] }
];

function buildCategoryGroups(categories = []) {
  const groups = CATEGORY_FAMILIES.map((family) => ({ ...family, categories: [] }));
  const other = { key: "other", label: "Other categories", categories: [] };

  categories.forEach((category) => {
    const normalized = category.toLowerCase();
    const group = groups.find((family) => family.terms.some((term) => normalized.includes(term)));
    (group || other).categories.push(category);
  });

  return [...groups, other]
    .filter((group) => group.categories.length)
    .map((group) => ({ ...group, categories: group.categories.sort((a, b) => a.localeCompare(b)) }));
}

function ProductCardImage({ product }) {
  const [failed, setFailed] = useState(false);
  const path = product.images?.[0]?.path;

  if (!path || failed) {
    return (
      <div className="product-media marketplace-product-media" role="img" aria-label={`${product.name} image unavailable`}>
        <ShoppingBag size={34} />
      </div>
    );
  }

  return (
    <img
      className="product-image marketplace-product-image"
      src={downloadUrl(path)}
      alt={product.name}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export default function Marketplace() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({
    q: "",
    sellerId: "",
    minPrice: "",
    maxPrice: "",
    sort: "newest",
    emiOnly: false,
    inStockOnly: false
  });
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [expandedGroups, setExpandedGroups] = useState({
    electronics: true,
    home: true,
    fashion: true,
    health: true,
    sports: true,
    other: true
  });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterMenuRef = useRef(null);
  const [selected, setSelected] = useState(null);
  const [request, setRequest] = useState({ downPayment: "0", tenureMonths: "6", selectedColorName: "" });
  const filterMeta = useQuery({ queryKey: ["product-filter-meta"], queryFn: async () => (await api.get("/products/meta/filters")).data });
  const categoryGroups = useMemo(
    () => buildCategoryGroups(filterMeta.data?.categories || []),
    [filterMeta.data?.categories]
  );
  const categorySelection = useMemo(() => {
    if (selectedCategory === "all") return { label: "All categories", values: [] };
    if (selectedCategory.startsWith("group:")) {
      const key = selectedCategory.slice(6);
      const group = categoryGroups.find((item) => item.key === key);
      return { label: group?.label || "All categories", values: group?.categories || [] };
    }
    const category = selectedCategory.slice(9);
    return { label: category || "All categories", values: category ? [category] : [] };
  }, [categoryGroups, selectedCategory]);
  const productParams = useMemo(() => ({
    q: filters.q,
    sellerId: filters.sellerId,
    minPrice: filters.minPrice,
    maxPrice: filters.maxPrice,
    sort: filters.sort,
    ...(categorySelection.values.length ? { categories: categorySelection.values.join(",") } : {}),
    ...(filters.emiOnly ? { emiAvailable: "true" } : {}),
    ...(filters.inStockOnly ? { inStock: "true" } : {})
  }), [categorySelection.values, filters]);
  const products = useQuery({
    queryKey: ["marketplace", productParams],
    queryFn: async () => (await api.get("/products", { params: productParams })).data
  });
  const activeFilterCount = [
    filters.sellerId,
    filters.minPrice,
    filters.maxPrice,
    filters.emiOnly,
    filters.inStockOnly,
    filters.sort !== "newest"
  ].filter(Boolean).length;
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
      api.post("/cart/items", {
        productId: selected._id,
        quantity: 1,
        selectedFinanceMode: "emi",
        selectedColorName: request.selectedColorName,
        replaceExisting: true
      }),
    onSuccess: ({ data }) => {
      const cartItem = (data.items || []).find(
        (item) => (item.productId?._id || item.productId) === selected._id && item.selectedColorName === request.selectedColorName
      );
      if (cartItem?._id) writeCheckoutSelection([cartItem._id]);
      setSelected(null);
      queryClient.invalidateQueries({ queryKey: ["cart"] });
      notifySuccess("EMI product is ready for checkout.");
      navigate("/checkout");
    },
    onError: (err) => notifyError(err, "Unable to prepare EMI checkout.")
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

  function toggleCategoryGroup(key) {
    setExpandedGroups((current) => ({ ...current, [key]: !current[key] }));
  }

  function categoryCount(categories) {
    return categories.reduce(
      (total, category) => total + Number(filterMeta.data?.categoryCounts?.[category] || 0),
      0
    );
  }

  function resetAdvancedFilters() {
    setFilters((current) => ({
      ...current,
      sellerId: "",
      minPrice: "",
      maxPrice: "",
      sort: "newest",
      emiOnly: false,
      inStockOnly: false
    }));
  }

  useEffect(() => {
    if (!filtersOpen) return undefined;

    function handlePointerDown(event) {
      if (!filterMenuRef.current?.contains(event.target)) setFiltersOpen(false);
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") setFiltersOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [filtersOpen]);

  return (
    <section className="dashboard marketplace-page">
      <div className="page-title marketplace-page-title">
        <div>
          <h1>Buyer Marketplace</h1>
          <p>Browse seller products and request EMI financing with a transparent payment preview.</p>
        </div>
        <div className="marketplace-toolbar">
          <div className="search-box">
            <Search size={18} />
            <input
              aria-label="Search marketplace products"
              placeholder="Search products"
              value={filters.q}
              onChange={(e) => setFilters({ ...filters, q: e.target.value })}
            />
          </div>
          <div className="marketplace-filter-menu" ref={filterMenuRef}>
            <button
              className={`button secondary marketplace-filter-trigger ${filtersOpen ? "active" : ""}`}
              type="button"
              aria-expanded={filtersOpen}
              aria-controls="marketplace-filter-popover"
              onClick={() => setFiltersOpen((open) => !open)}
            >
              <Filter size={17} />
              Filters
              {activeFilterCount > 0 && <span className="filter-count">{activeFilterCount}</span>}
              <ChevronDown size={16} />
            </button>
            {filtersOpen && (
              <div id="marketplace-filter-popover" className="marketplace-filter-popover">
                <div className="filter-popover-header">
                  <div>
                    <strong>Filter products</strong>
                    <span>Refine the current category.</span>
                  </div>
                  <button className="filter-close-button" type="button" aria-label="Close filters" onClick={() => setFiltersOpen(false)}>
                    <X size={19} />
                  </button>
                </div>
                <div className="marketplace-filter-fields">
                  <label>Seller
                    <select value={filters.sellerId} onChange={(e) => setFilters({ ...filters, sellerId: e.target.value })}>
                      <option value="">All sellers</option>
                      {(filterMeta.data?.sellers || []).map((seller) => <option key={seller._id} value={seller._id}>{seller.name}</option>)}
                    </select>
                  </label>
                  <div className="marketplace-price-fields">
                    <label>Minimum price
                      <input type="number" min="0" value={filters.minPrice} onChange={(e) => setFilters({ ...filters, minPrice: e.target.value })} placeholder="BDT" />
                    </label>
                    <label>Maximum price
                      <input type="number" min="0" value={filters.maxPrice} onChange={(e) => setFilters({ ...filters, maxPrice: e.target.value })} placeholder="BDT" />
                    </label>
                  </div>
                  <label>Sort products
                    <select value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value })}>
                      <option value="newest">Newest first</option>
                      <option value="price_asc">Price: low to high</option>
                      <option value="price_desc">Price: high to low</option>
                      <option value="popular">Featured first</option>
                    </select>
                  </label>
                  <label className="marketplace-filter-check">
                    <input type="checkbox" checked={filters.emiOnly} onChange={(e) => setFilters({ ...filters, emiOnly: e.target.checked })} />
                    <span><strong>EMI available</strong><small>Only show products that support EMI.</small></span>
                  </label>
                  <label className="marketplace-filter-check">
                    <input type="checkbox" checked={filters.inStockOnly} onChange={(e) => setFilters({ ...filters, inStockOnly: e.target.checked })} />
                    <span><strong>In stock</strong><small>Hide products with no available stock.</small></span>
                  </label>
                </div>
                <div className="filter-popover-actions">
                  <button className="button ghost" type="button" onClick={resetAdvancedFilters}>
                    <RotateCcw size={16} />
                    Reset
                  </button>
                  <button className="button" type="button" onClick={() => setFiltersOpen(false)}>View results</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="marketplace-layout">
        <aside className="marketplace-category-sidebar" aria-label="Product categories">
          <div className="category-sidebar-heading">
            <strong>Categories</strong>
            <span>{categoryCount(filterMeta.data?.categories || [])} products</span>
          </div>
          <button
            className={`marketplace-category-all ${selectedCategory === "all" ? "active" : ""}`}
            type="button"
            onClick={() => setSelectedCategory("all")}
          >
            <span>All products</span>
            <strong>{categoryCount(filterMeta.data?.categories || [])}</strong>
          </button>
          <div className="marketplace-category-tree">
            {categoryGroups.map((group) => {
              const expanded = expandedGroups[group.key];
              const groupSelected = selectedCategory === `group:${group.key}`;
              return (
                <div className="marketplace-category-group" key={group.key}>
                  <div className={`category-parent-row ${groupSelected ? "active" : ""}`}>
                    <button
                      className="category-parent-select"
                      type="button"
                      onClick={() => setSelectedCategory(`group:${group.key}`)}
                    >
                      <span>{group.label}</span>
                      <strong>{categoryCount(group.categories)}</strong>
                    </button>
                    <button
                      className="category-expand-button"
                      type="button"
                      aria-label={`${expanded ? "Collapse" : "Expand"} ${group.label}`}
                      aria-expanded={expanded}
                      onClick={() => toggleCategoryGroup(group.key)}
                    >
                      {expanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
                    </button>
                  </div>
                  {expanded && (
                    <div className="category-children">
                      {group.categories.map((category) => (
                        <button
                          className={selectedCategory === `category:${category}` ? "active" : ""}
                          type="button"
                          key={category}
                          onClick={() => setSelectedCategory(`category:${category}`)}
                        >
                          <span>{category}</span>
                          <strong>{filterMeta.data?.categoryCounts?.[category] || 0}</strong>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </aside>

        <section className="marketplace-results" aria-live="polite">
          <div className="marketplace-results-heading">
            <div>
              <span>Showing category</span>
              <strong>{categorySelection.label}</strong>
            </div>
            <span>{products.isPending ? "Loading..." : `${(products.data || []).length} products`}</span>
          </div>

          {products.isError && <div className="marketplace-empty-state">Products could not be loaded right now.</div>}
          {!products.isPending && !products.isError && (products.data || []).length === 0 && (
            <div className="marketplace-empty-state">
              <ShoppingBag size={32} />
              <strong>No products found</strong>
              <span>Try another category or reset the filters.</span>
              <button
                className="button secondary"
                type="button"
                onClick={() => {
                  resetAdvancedFilters();
                  setSelectedCategory("all");
                  setFilters((current) => ({ ...current, q: "" }));
                }}
              >
                Reset filters
              </button>
            </div>
          )}

          <div className="product-grid marketplace-product-grid">
            {(products.data || []).map((product) => (
              <article className="product-card marketplace-product-card" key={product._id}>
                <ProductCardImage product={product} />
                <div className="marketplace-card-content">
                  {sellerProfileId(product) && (
                    <Link className="seller-mini-link" to={`/stores/${sellerProfileId(product)}`}>
                      <Store size={14} /> {product.sellerId?.name || "Seller store"}
                    </Link>
                  )}
                  <h2>{product.name}</h2>
                  <p>{product.description || "EMI-ready product from a local seller."}</p>
                  <div className="marketplace-card-badges">
                    <span className={`badge ${product.emiAvailable ? "active" : ""}`}>{product.emiAvailable ? "EMI available" : "Cash only"}</span>
                    {product.stock <= 3 && product.stock > 0 && <span className="badge warning">Low stock</span>}
                  </div>
                  <div className="product-meta">
                    <strong>{formatBDT(product.price)}</strong>
                    <span>{product.stock} in stock</span>
                  </div>
                  <div className="button-row marketplace-card-actions">
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
                    <button
                      className="button secondary quick-emi-button"
                      disabled={!user || user.role !== "buyer" || !product.emiAvailable}
                      onClick={() => openQuickEmi(product)}
                    >
                      Quick EMI
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>

      {selected && (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); requestLoan.mutate(); }}>
            <h2>Start EMI checkout for {selected.name}</h2>
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
            <p className="hint">You will confirm the down payment, tenure, shipping address, and full EMI terms on checkout. This keeps the EMI request connected to its product order and delivery.</p>
            <button className="button" disabled={requestLoan.isPending}>{requestLoan.isPending ? "Preparing..." : "Continue to checkout"}</button>
          </form>
        </div>
      )}
    </section>
  );
}
