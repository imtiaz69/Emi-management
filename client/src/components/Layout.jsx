import { Link, NavLink, Outlet } from "react-router-dom";
import { Bell, LogOut, Package, ShieldCheck, Store, UserRound } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext.jsx";
import { api } from "../api/http";

export default function Layout() {
  const { user, logout } = useAuth();
  const { data: notifications = [] } = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => (await api.get("/notifications")).data,
    enabled: Boolean(user)
  });

  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink className="brand" to="/">
          <Store size={22} />
          <span>FinanceLend</span>
        </NavLink>
        <nav className="nav-links">
          <NavLink to="/">Home</NavLink>
          <NavLink to="/marketplace">Marketplace</NavLink>
          <Link to="/#features">Features</Link>
          <Link to="/#about">About Us</Link>
          {user?.role === "buyer" && <NavLink to="/cart">Cart</NavLink>}
          {user?.role === "buyer" && <NavLink to="/orders">Orders</NavLink>}
          {user?.role === "seller" && <NavLink to="/orders">Orders</NavLink>}
          {user?.role === "seller" && <NavLink to="/seller">Seller Dashboard</NavLink>}
          {user?.role === "buyer" && <NavLink to="/buyer">Buyer Portal</NavLink>}
          {user?.role === "admin" && <NavLink to="/admin">Admin</NavLink>}
          {user && <NavLink to="/account">Account</NavLink>}
        </nav>
        <div className="top-actions">
          {user && (
            <span className="notification-pill">
              <Bell size={16} /> {notifications.length}
            </span>
          )}
          {user ? (
            <button className="ghost-button" onClick={logout}>
              <LogOut size={16} /> {user.name}
            </button>
          ) : (
            <NavLink className="button small" to="/login">
              Login
            </NavLink>
          )}
        </div>
      </header>
      <main>
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="footer-top">
          <div className="footer-brand">
            <div className="brand">
              <Store size={24} />
              <span>FinanceLend</span>
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
              <Link to="/">Blog</Link>
              <Link to="/">Documentation</Link>
              <Link to="/">ChangeLog</Link>
              <Link to="/">Support</Link>
            </div>
            <div className="footer-col">
              <strong>Overview</strong>
              <Link to="/">Blog</Link>
              <Link to="/">Documentation</Link>
              <Link to="/">ChangeLog</Link>
              <Link to="/">Support</Link>
            </div>
            <div className="footer-col">
              <strong>Core System</strong>
              <Link to="/">Blog</Link>
              <Link to="/">Documentation</Link>
              <Link to="/">ChangeLog</Link>
              <Link to="/">Support</Link>
            </div>
          </div>
        </div>
        <div className="footer-bottom">Copyright 2026 finance-lend-saas</div>
      </footer>
    </div>
  );
}
