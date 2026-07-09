import { Navigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

export default function SellerPending() {
  const { user } = useAuth();

  if (user?.role === "seller" && user.status === "active") {
    return <Navigate to="/seller" replace />;
  }

  return (
    <section className="dashboard">
      <div className="page-title">
        <div>
          <h1>Seller Approval Pending</h1>
          <p>Your seller account is waiting for admin approval before dashboard actions are unlocked.</p>
        </div>
      </div>

      <section className="panel">
        <h2>Account status</h2>
        <div className="notice warning">
          Current status: {String(user?.status || "pending_admin_approval").replaceAll("_", " ")}
        </div>
        <p className="muted">
          You can browse the marketplace while waiting. After admin approval, this page will automatically redirect you to the seller dashboard.
        </p>
        <div className="button-row" style={{ marginTop: "16px" }}>
          <Link className="button" to="/marketplace">Browse marketplace</Link>
          <Link className="button secondary" to="/">Go home</Link>
        </div>
      </section>
    </section>
  );
}
