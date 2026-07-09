import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, ShoppingBag } from "lucide-react";
import { api } from "../api/http";
import { useAuth } from "../context/AuthContext.jsx";

export default function Home() {
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const roleAction = user?.role === "admin"
    ? { label: "Go to Admin Panel", to: "/admin" }
    : user?.role === "seller"
      ? { label: user.status === "active" ? "Go to Seller Dashboard" : "Check seller approval", to: user.status === "active" ? "/seller" : "/seller/pending" }
      : user?.role === "buyer"
        ? { label: "Go to Buyer Portal", to: "/buyer" }
        : null;

  const products = useQuery({
    queryKey: ["marketplace", q],
    queryFn: async () => (await api.get("/products", { params: { q } })).data
  });

  return (
    <section className="home-page">
      <div className="home-hero">
        <div className="hero-copy">
          <span className="eyebrow">Buy smarter with EMI</span>
          <h1>Shop products from trusted local sellers with flexible EMI options.</h1>
          <p>
            EMI Management connects buyers and sellers, making it easy to discover products,
            compare EMI terms, and request financing without leaving the platform.
          </p>
          <div className="hero-actions">
            <Link className="button" to="/marketplace">
              Browse products
            </Link>
            {roleAction ? (
              <Link className="button secondary" to={roleAction.to}>
                {roleAction.label}
              </Link>
            ) : (
              <>
                <Link className="button secondary" to="/register?role=buyer">
                  Register as buyer
                </Link>
                <Link className="button secondary" to="/register?role=seller">
                  Register as seller
                </Link>
              </>
            )}
          </div>
        </div>
        <div className="hero-banner">
          <div>
            <h2>One marketplace for all EMI-ready listings</h2>
            <p>
              Sellers can list EMI-capable products and buyers can request EMI plans with
              clear terms and instant tracking.
            </p>
          </div>
        </div>
      </div>

      <div className="page-title">
        <div>
          <h1>Featured Seller Products</h1>
          <p>Explore the newest products available across all verified sellers.</p>
        </div>
        <div className="search-box">
          <Search size={18} />
          <input placeholder="Search products" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <div className="product-grid">
        {(products.data || []).map((product) => (
          <article className="product-card" key={product._id}>
            <div className="product-media">
              <ShoppingBag size={34} />
            </div>
            <h2>{product.name}</h2>
            <p>{product.description || "EMI-ready product from a local seller."}</p>
            <div className="product-meta">
              <strong>BDT {product.price}</strong>
              <span>{product.stock} in stock</span>
            </div>
            <div className="button-row">
              <Link className="button small" to={`/products/${product._id}`}>
                View details
              </Link>
              {product.emiAvailable ? <span className="badge active">EMI available</span> : <span className="badge">Cash only</span>}
            </div>
          </article>
        ))}
      </div>

      <section id="features" className="info-section">
        <h2>Features Built for Easy EMI Lending</h2>
        <div className="feature-grid">
          <article className="feature-card">
            <h3>Seller Dashboard</h3>
            <p>Track loan requests, approve KYC documents, and manage EMI schedules from one place.</p>
          </article>
          <article className="feature-card">
            <h3>Buyer Experience</h3>
            <p>Browse EMI-ready products, upload KYC, and request flexible payment plans quickly.</p>
          </article>
          <article className="feature-card">
            <h3>Admin Oversight</h3>
            <p>Review users, monitor approvals, and keep lending operations compliant and transparent.</p>
          </article>
        </div>
      </section>

      <section id="about" className="about-section">
        <div>
          <h2>About FinanceLend</h2>
          <p>
            FinanceLend is a loan management platform designed for modern lenders, sellers and buyers.
            It simplifies EMI workflows, automates KYC approval, and provides visibility across the entire loan lifecycle.
          </p>
        </div>
      </section>
    </section>
  );
}
