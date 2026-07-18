import { Fragment, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  LogOut,
  Menu,
  Settings,
  ShoppingBag,
  UserRound,
  X
} from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { notifySuccess } from "../utils/toast.js";
import BrandMark from "./BrandMark.jsx";
import NotificationCenter from "./NotificationCenter.jsx";

export default function DashboardShell({
  title,
  description,
  roleLabel,
  tabs,
  activeTab,
  onTabChange,
  headerActions,
  children
}) {
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const menuButtonRef = useRef(null);
  const closeButtonRef = useRef(null);
  const activeItem = tabs.find((tab) => tab.key === activeTab);

  useEffect(() => {
    document.body.classList.toggle("dashboard-drawer-open", sidebarOpen);
    if (sidebarOpen) closeButtonRef.current?.focus();

    function handleEscape(event) {
      if (event.key === "Escape") {
        setSidebarOpen(false);
        menuButtonRef.current?.focus();
      }
    }

    if (sidebarOpen) window.addEventListener("keydown", handleEscape);
    return () => {
      document.body.classList.remove("dashboard-drawer-open");
      window.removeEventListener("keydown", handleEscape);
    };
  }, [sidebarOpen]);

  function selectTab(key) {
    onTabChange(key);
    setSidebarOpen(false);
  }

  function handleLogout() {
    logout();
    notifySuccess("Logged out successfully.");
  }

  let previousGroup = "";

  return (
    <section className={`dashboard-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      <aside id="dashboard-navigation" className={`dashboard-sidebar ${sidebarOpen ? "open" : ""}`} aria-label={`${roleLabel} navigation`}>
        <div className="dashboard-sidebar-heading">
          <Link to="/" className="dashboard-brand-link" aria-label="FinanceLend home">
            <BrandMark compact={collapsed} />
          </Link>
          <button
            className="dashboard-sidebar-close"
            type="button"
            ref={closeButtonRef}
            onClick={() => {
              setSidebarOpen(false);
              menuButtonRef.current?.focus();
            }}
            aria-label="Close navigation"
          >
            <X size={20} />
          </button>
        </div>

        <div className="dashboard-role-label">
          {!collapsed && <span>{roleLabel}</span>}
          <strong title={user?.name}>{collapsed ? user?.name?.slice(0, 1) || "U" : user?.name}</strong>
        </div>

        <nav className="dashboard-nav">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const showGroup = tab.group && tab.group !== previousGroup;
            previousGroup = tab.group || previousGroup;
            return (
              <Fragment key={tab.key}>
                {showGroup && !collapsed && <span className="dashboard-nav-group">{tab.group}</span>}
                <button
                  className={`dashboard-nav-item ${activeTab === tab.key ? "active" : ""}`}
                  type="button"
                  onClick={() => selectTab(tab.key)}
                  aria-current={activeTab === tab.key ? "page" : undefined}
                  title={collapsed ? tab.label : undefined}
                >
                  {Icon && <Icon size={18} aria-hidden="true" />}
                  {!collapsed && <span>{tab.label}</span>}
                </button>
              </Fragment>
            );
          })}
        </nav>

        <div className="dashboard-sidebar-footer">
          <Link className="dashboard-nav-item" to="/marketplace" title={collapsed ? "Marketplace" : undefined}>
            <ShoppingBag size={18} />
            {!collapsed && <span>Marketplace</span>}
          </Link>
          <Link className="dashboard-nav-item" to="/account" title={collapsed ? "Account settings" : undefined}>
            <Settings size={18} />
            {!collapsed && <span>Account settings</span>}
          </Link>
          <button className="dashboard-nav-item" type="button" onClick={handleLogout} title={collapsed ? "Logout" : undefined}>
            <LogOut size={18} />
            {!collapsed && <span>Logout</span>}
          </button>
        </div>
      </aside>

      <button
        className={`dashboard-sidebar-backdrop ${sidebarOpen ? "visible" : ""}`}
        type="button"
        onClick={() => {
          setSidebarOpen(false);
          menuButtonRef.current?.focus();
        }}
        aria-label="Close navigation"
        tabIndex={sidebarOpen ? 0 : -1}
      />

      <div className="dashboard-main">
        <header className="dashboard-topbar">
          <div className="dashboard-topbar-leading">
            <button
              className="dashboard-mobile-menu"
              type="button"
              ref={menuButtonRef}
              onClick={() => setSidebarOpen(true)}
              aria-label="Open navigation"
              aria-expanded={sidebarOpen}
              aria-controls="dashboard-navigation"
            >
              <Menu size={21} />
            </button>
            <button
              className="dashboard-collapse-button"
              type="button"
              onClick={() => setCollapsed((value) => !value)}
              aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
              title={collapsed ? "Expand navigation" : "Collapse navigation"}
            >
              {collapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
            </button>
            <div className="dashboard-page-heading">
              <span>{roleLabel}{activeItem ? ` / ${activeItem.label}` : ""}</span>
              <h1>{title}</h1>
              {description && <p>{description}</p>}
            </div>
          </div>

          <div className="dashboard-topbar-actions">
            {headerActions}
            <Link className="dashboard-icon-button" to="/marketplace" aria-label="Open marketplace" title="Marketplace">
              <ShoppingBag size={19} />
            </Link>
            <NotificationCenter onViewAll={tabs.some((tab) => tab.key === "notifications") ? () => selectTab("notifications") : undefined} />
            <Link className="dashboard-user-button" to="/account" title="Account settings">
              <span className="dashboard-user-avatar"><UserRound size={17} /></span>
              <span>
                <strong>{user?.name}</strong>
                <small>{roleLabel}</small>
              </span>
            </Link>
          </div>
        </header>

        <div className="dashboard-workspace">
          <div className="dashboard-content-stack">{children}</div>
        </div>
      </div>
    </section>
  );
}
