import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  BellRing,
  ClipboardCheck,
  Search,
  ShieldCheck,
  ShoppingBag,
  Store,
  Users,
  WalletCards
} from "lucide-react";
import { api, downloadUrl } from "../api/http";
import { useAuth } from "../context/AuthContext.jsx";
import automatedNotifications from "../assets/automated-notifications.svg";
import sellerMacbook from "../assets/financelend-seller-macbook.png";
import operationsSecurity from "../assets/operations-security.svg";

function ProductCardImage({ product }) {
  const [failed, setFailed] = useState(false);
  const imagePath = product.images?.[0]?.path;

  if (!imagePath || failed) {
    return (
      <div className="product-media" role="img" aria-label={`${product.name} image unavailable`}>
        <ShoppingBag size={34} />
      </div>
    );
  }

  return (
    <img
      className="product-image"
      src={downloadUrl(imagePath)}
      alt={product.name}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

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
          <span className="eyebrow">
            <BadgeCheck size={17} />
            Commerce and lending, connected
          </span>
          <h1>EMI management and loan tracking for local commerce.</h1>
          <p>
            FinanceLend gives sellers, buyers, and administrators one clear workspace for
            products, KYC, EMI requests, repayments, and portfolio reporting.
          </p>
          <div className="hero-actions">
            <Link className="button" to="/marketplace">
              Browse marketplace
              <ArrowRight size={17} />
            </Link>
            {roleAction ? (
              <Link className="button secondary" to={roleAction.to}>
                {roleAction.label}
              </Link>
            ) : (
              <Link className="button secondary" to="/register">
                Create account
              </Link>
            )}
          </div>
        </div>
        <div className="hero-device-stage">
          <img
            src={sellerMacbook}
            alt="FinanceLend seller dashboard displayed on a MacBook"
            fetchPriority="high"
          />
        </div>
      </div>

      <section className="home-proof-strip" aria-label="FinanceLend platform coverage">
        <div>
          <Store size={22} />
          <span><strong>Seller workspace</strong> Products, orders, and collections</span>
        </div>
        <div>
          <WalletCards size={22} />
          <span><strong>Flexible EMI</strong> Clear schedules and payment history</span>
        </div>
        <div>
          <ShieldCheck size={22} />
          <span><strong>Protected KYC</strong> Controlled document review</span>
        </div>
        <div>
          <BarChart3 size={22} />
          <span><strong>Portfolio insight</strong> Due, collection, and overdue reporting</span>
        </div>
      </section>

      <section className="home-marketplace-section" aria-labelledby="featured-products-title">
        <div className="page-title home-section-heading">
          <div>
            <span className="section-kicker">Marketplace</span>
            <h2 id="featured-products-title">Featured seller products</h2>
            <p>Explore recent products available from active FinanceLend sellers.</p>
          </div>
          <div className="search-box">
            <Search size={18} />
            <input
              aria-label="Search featured products"
              placeholder="Search products"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>

        {products.isPending && <div className="home-product-state">Loading products...</div>}
        {products.isError && (
          <div className="home-product-state error">Products could not be loaded right now.</div>
        )}
        {!products.isPending && !products.isError && (products.data || []).length === 0 && (
          <div className="home-product-state">
            <ShoppingBag size={30} />
            <span>No products match your search.</span>
          </div>
        )}
        <div className="product-grid home-product-grid">
          {(products.data || []).slice(0, 5).map((product) => (
            <article className="product-card" key={product._id}>
              <ProductCardImage product={product} />
              <h3>{product.name}</h3>
              <p>{product.description || "EMI-ready product from a local seller."}</p>
              <div className="product-meta">
                <strong>BDT {product.price}</strong>
                <span>{product.stock} in stock</span>
              </div>
              <div className="button-row">
                <Link className="button small" to={`/products/${product._id}`}>
                  View details
                </Link>
                {product.emiAvailable
                  ? <span className="badge active">EMI available</span>
                  : <span className="badge">Cash only</span>}
              </div>
            </article>
          ))}
        </div>

        {(products.data || []).length > 0 && (
          <div className="home-section-action">
            <Link className="button secondary" to="/marketplace">
              View all products
              <ArrowRight size={17} />
            </Link>
          </div>
        )}
      </section>

      <section id="features" className="home-story-section">
        <div className="home-story-visual">
          <img src={operationsSecurity} alt="" aria-hidden="true" />
        </div>
        <div>
          <span className="section-kicker">Controlled workflows</span>
          <h2>Move from request to repayment with less paperwork.</h2>
          <p>
            Each role sees the tools and records needed for its part of the lending cycle,
            while sensitive KYC documents remain inside protected review workflows.
          </p>
          <ul className="home-check-list">
            <li><ClipboardCheck size={19} /> Submit and review EMI requests with structured data.</li>
            <li><ShieldCheck size={19} /> Keep approval, ownership, and document access controlled.</li>
            <li><BarChart3 size={19} /> Track principal, paid amounts, due dates, and overdue risk.</li>
            <li><WalletCards size={19} /> Maintain a clear installment and payment record.</li>
          </ul>
        </div>
      </section>

      <section className="home-capabilities" aria-labelledby="capabilities-title">
        <div className="home-section-heading centered">
          <span className="section-kicker">One connected system</span>
          <h2 id="capabilities-title">What FinanceLend brings together</h2>
          <p>Practical tools for the daily work behind product-based EMI lending.</p>
        </div>
        <div className="capability-grid">
          <article>
            <Store size={23} />
            <h3>Commerce operations</h3>
            <p>Product listings, inventory, cart, checkout, and seller order management.</p>
          </article>
          <article>
            <Users size={23} />
            <h3>Role-based workspaces</h3>
            <p>Focused experiences for buyers, sellers, and platform administrators.</p>
          </article>
          <article>
            <BellRing size={23} />
            <h3>Lifecycle visibility</h3>
            <p>Notifications and statuses across requests, KYC, orders, and payments.</p>
          </article>
          <article>
            <BarChart3 size={23} />
            <h3>Operational reporting</h3>
            <p>Sales, collections, dues, overdue balances, and exportable records.</p>
          </article>
        </div>
      </section>

      <section className="home-story-section reverse">
        <div>
          <span className="section-kicker">Timely account activity</span>
          <h2>Keep every participant informed as records change.</h2>
          <p>
            Buyers can follow orders and installments, sellers can monitor collections and
            pending requests, and administrators can review platform activity from one system.
          </p>
          <div className="home-role-list">
            <div><strong>Buyer</strong><span>Shop, submit KYC, request EMI, and track payments.</span></div>
            <div><strong>Seller</strong><span>Manage products, lending decisions, orders, and collections.</span></div>
            <div><strong>Admin</strong><span>Review approvals, moderate records, and inspect audit activity.</span></div>
          </div>
        </div>
        <div className="home-story-visual">
          <img src={automatedNotifications} alt="" aria-hidden="true" />
        </div>
      </section>

      <section id="about" className="home-closing-band">
        <div>
          <span className="section-kicker">About FinanceLend</span>
          <h2>A practical EMI platform built around real workflows.</h2>
          <p>
            FinanceLend connects marketplace activity with loan management so every approved
            request can be followed from product selection through repayment.
          </p>
        </div>
        <Link className="button" to={user ? roleAction?.to || "/account" : "/register"}>
          {user ? roleAction?.label || "Open account" : "Get started"}
          <ArrowRight size={17} />
        </Link>
      </section>
    </section>
  );
}
