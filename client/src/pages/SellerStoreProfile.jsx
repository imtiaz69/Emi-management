import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CreditCard, Mail, MapPin, Package, Phone, Search, ShieldCheck, ShoppingBag, Star, Store } from "lucide-react";
import dayjs from "dayjs";
import { api } from "../api/http";
import StatCard from "../components/StatCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";

export default function SellerStoreProfile() {
  const { sellerId } = useParams();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const storeQuery = useQuery({
    queryKey: ["seller-store", sellerId],
    queryFn: async () => (await api.get(`/profiles/sellers/${sellerId}`)).data
  });

  const store = storeQuery.data;
  const products = store?.products || [];
  const categories = store?.stats?.categories || [];
  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products.filter((product) => {
      const matchesCategory = !category || product.category === category;
      const matchesSearch =
        !query ||
        [product.name, product.description, product.category, product.brand, product.sku]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query));
      return matchesCategory && matchesSearch;
    });
  }, [category, products, search]);

  if (storeQuery.isLoading) return <section className="dashboard"><div className="panel">Loading store profile...</div></section>;
  if (storeQuery.isError || !store) {
    return (
      <section className="dashboard">
        <div className="panel empty-state">
          <Store size={42} />
          <div>
            <h1>Store not found</h1>
            <p>This seller store is unavailable or has not been approved yet.</p>
          </div>
        </div>
      </section>
    );
  }

  const profile = store.profile || {};
  const shopName = profile.shopName || `${store.seller.name}'s Store`;
  const ownerName = profile.ownerName || store.seller.name;

  return (
    <section className="dashboard profile-page">
      <section className="profile-hero">
        <div className="profile-hero-icon"><Store size={36} /></div>
        <div className="profile-hero-content">
          <span className="badge approved"><ShieldCheck size={14} /> Approved store</span>
          <h1>{shopName}</h1>
          <p>Managed by {ownerName}. Browse verified products, EMI-ready listings, and direct seller contact information.</p>
          <div className="profile-meta-list">
            {profile.address && <span><MapPin size={15} /> {profile.address}</span>}
            <span><Star size={15} /> {store.stats.averageRating || "New"} rating ({store.stats.reviewCount || 0} reviews)</span>
            {store.seller.phone && <span><Phone size={15} /> {store.seller.phone}</span>}
            {store.seller.email && <span><Mail size={15} /> {store.seller.email}</span>}
            <span><Package size={15} /> Joined {dayjs(store.seller.createdAt).format("MMM YYYY")}</span>
          </div>
        </div>
      </section>

      <div className="stats-grid">
        <StatCard label="Active products" value={store.stats.totalProducts} tone="green" />
        <StatCard label="EMI products" value={store.stats.emiProducts} tone="purple" />
        <StatCard label="Seller rating" value={store.stats.reviewCount ? `${store.stats.averageRating} / 5` : "New"} tone="green" />
        <StatCard label="Available stock" value={store.stats.totalStock} />
        <StatCard label="Price range" value={`${formatBDT(store.stats.minPrice)} - ${formatBDT(store.stats.maxPrice)}`} tone="green" />
      </div>

      <section className="panel">
        <div className="store-toolbar">
          <div>
            <h2><ShoppingBag size={18} /> Store products</h2>
            <p>{filteredProducts.length} product{filteredProducts.length === 1 ? "" : "s"} available from this seller.</p>
          </div>
          <div className="store-filter-row">
            <div className="search-box">
              <Search size={18} />
              <input placeholder="Search this store" value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
            <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter store category">
              <option value="">All categories</option>
              {categories.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
        </div>

        <div className="store-category-strip">
          <button className={`category-chip ${!category ? "active" : ""}`} onClick={() => setCategory("")}>All</button>
          {categories.map((item) => (
            <button className={`category-chip ${category === item ? "active" : ""}`} key={item} onClick={() => setCategory(item)}>
              {item}
            </button>
          ))}
        </div>

        <div className="product-grid store-product-grid">
          {filteredProducts.map((product) => (
            <article className="product-card store-product-card" key={product._id}>
              {product.images?.[0]?.path ? (
                <img className="product-image" src={product.images[0].path} alt={product.name} />
              ) : (
                <div className="product-media"><ShoppingBag size={34} /></div>
              )}
              <div className="store-card-title">
                <h2>{product.name}</h2>
                {product.emiAvailable && <span className="badge approved"><CreditCard size={13} /> EMI</span>}
              </div>
              <p>{product.description || "Product listed by this verified seller."}</p>
              <div className="product-meta">
                <strong>{formatBDT(product.price)}</strong>
                <span>{product.stock} in stock</span>
              </div>
              <div className="button-row">
                <Link className="button" to={`/products/${product._id}`}>View details</Link>
                <StatusBadge status={product.status} />
              </div>
            </article>
          ))}
        </div>

        {filteredProducts.length === 0 && (
          <div className="empty-state">
            <Search size={36} />
            <p>No products match this store filter.</p>
          </div>
        )}
      </section>
    </section>
  );
}

function formatBDT(value) {
  return `BDT ${Math.round(Number(value || 0)).toLocaleString("en-BD")}`;
}
