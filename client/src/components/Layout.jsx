import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Heart, LogOut, Menu, X } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { notifySuccess } from "../utils/toast.js";
import BrandMark from "./BrandMark.jsx";
import NotificationCenter from "./NotificationCenter.jsx";

export default function Layout() {
  const location = useLocation();
  const { user, logout } = useAuth();
  const [publicMenuOpen, setPublicMenuOpen] = useState(false);
  const isDashboardRoute = ["/admin", "/seller", "/buyer"].includes(location.pathname);

  function handleLogout() {
    setPublicMenuOpen(false);
    logout();
    notifySuccess("Logged out successfully.");
  }

  useEffect(() => {
    setPublicMenuOpen(false);
  }, [location.pathname, location.search, location.hash]);

  useEffect(() => {
    if (!publicMenuOpen) return undefined;
    function handleEscape(event) {
      if (event.key === "Escape") setPublicMenuOpen(false);
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [publicMenuOpen]);

  if (isDashboardRoute) {
    return (
      <div className="app-shell dashboard-route">
        <Outlet />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink className="brand" to="/" aria-label="FinanceLend home">
          <BrandMark />
        </NavLink>
        <button
          className="public-menu-toggle"
          type="button"
          aria-label={publicMenuOpen ? "Close navigation" : "Open navigation"}
          aria-controls="public-navigation"
          aria-expanded={publicMenuOpen}
          onClick={() => setPublicMenuOpen((open) => !open)}
        >
          {publicMenuOpen ? <X size={21} /> : <Menu size={21} />}
        </button>
        <div id="public-navigation" className={`public-nav-panel ${publicMenuOpen ? "open" : ""}`}>
          <nav className="nav-links" onClick={() => setPublicMenuOpen(false)}>
            <NavLink to="/">Home</NavLink>
            <NavLink to="/marketplace">Marketplace</NavLink>
            <Link to="/#features">Features</Link>
            <Link to="/#about">About Us</Link>
            {user?.role === "buyer" && <NavLink to="/cart">Cart</NavLink>}
            {user?.role === "buyer" && <NavLink to="/buyer?tab=wishlist"><Heart size={15} /> Wishlist</NavLink>}
            {user?.role === "buyer" && <NavLink to="/orders">Orders</NavLink>}
            {user?.role === "seller" && <NavLink to="/orders">Orders</NavLink>}
            {user?.role === "seller" && <NavLink to="/seller">Seller Dashboard</NavLink>}
            {user?.role === "buyer" && <NavLink to="/buyer">Buyer Portal</NavLink>}
            {user?.role === "admin" && <NavLink to="/admin">Admin</NavLink>}
            {user && <NavLink to="/account">Account</NavLink>}
          </nav>
          <div className="top-actions">
            {user && (
              <NotificationCenter
                variant="public"
                onViewAll={() => {
                  const dashboard = user.role === "buyer" ? "/buyer" : user.role === "seller" ? "/seller" : "/admin";
                  window.location.assign(`${dashboard}?tab=notifications`);
                }}
              />
            )}
            {user ? (
              <button className="ghost-button" onClick={handleLogout}>
                <LogOut size={16} /> {user.name}
              </button>
            ) : (
              <NavLink className="button small" to="/login">
                Login
              </NavLink>
            )}
          </div>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="footer-top">
          <div className="footer-brand">
            <div className="brand">
              <BrandMark />
            </div>
            <p>
              FinanceLend Loan Management Solution delivers a polished, secure platform for sellers,
              buyers, and lenders to handle EMI requests, KYC review, and loan tracking.
            </p>
          </div>
          <div className="footer-columns">
            <div className="footer-col">
              <strong>Quick Links</strong>
              <Link to="/">Home</Link>
              <Link to="/marketplace">Marketplace</Link>
              <Link to="/#features">Features</Link>
              <Link to="/#about">About Us</Link>
            </div>
            <div className="footer-col">
              <strong>Help</strong>
              <Link to="/login">Sign in</Link>
              <Link to="/register">Create account</Link>
              <Link to="/verify-email">Verify email</Link>
              <Link to="/account">Account settings</Link>
            </div>
            <div className="footer-col">
              <strong>Workspaces</strong>
              <Link to="/buyer">Buyer portal</Link>
              <Link to="/seller">Seller dashboard</Link>
              <Link to="/admin">Admin workspace</Link>
              <Link to="/orders">Orders</Link>
            </div>
            <div className="footer-col">
              <strong>Finance Tools</strong>
              <Link to="/marketplace">Product marketplace</Link>
              <Link to="/cart">Shopping cart</Link>
              <Link to="/orders">Order tracking</Link>
              <Link to="/account">Profile and security</Link>
            </div>
          </div>
        </div>
        <div className="footer-bottom">Copyright 2026 FinanceLend. All rights reserved.</div>
      </footer>
    </div>
  );
}
