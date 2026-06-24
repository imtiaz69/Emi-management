import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

export default function Register() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const defaultRole = searchParams.get("role") === "seller" ? "seller" : "buyer";
  const { register } = useAuth();
  const [role, setRole] = useState(defaultRole);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    password: "User@123",
    shopName: "",
    address: "",
    tradeLicenseNo: ""
  });

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    try {
      const { user } = await register({ ...form, role, ownerName: form.name });
      navigate(user.role === "seller" ? "/seller" : "/buyer");
    } catch (err) {
      setError(err.response?.data?.message || "Registration failed");
    }
  }

  return (
    <section className="auth-page">
      <form className="auth-panel wide" onSubmit={handleSubmit}>
        <h1>Create account</h1>
        <div className="segmented">
          <button type="button" className={role === "buyer" ? "active" : ""} onClick={() => setRole("buyer")}>Buyer</button>
          <button type="button" className={role === "seller" ? "active" : ""} onClick={() => setRole("seller")}>Seller</button>
        </div>
        <div className="form-grid">
          <label>Name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>Email<input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label>Phone<input required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
          <label>Password<input required type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
          <label>Address<input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></label>
          {role === "seller" && (
            <>
              <label>Shop name<input required value={form.shopName} onChange={(e) => setForm({ ...form, shopName: e.target.value })} /></label>
              <label>Trade license<input value={form.tradeLicenseNo} onChange={(e) => setForm({ ...form, tradeLicenseNo: e.target.value })} /></label>
            </>
          )}
        </div>
        {error && <div className="error">{error}</div>}
        <button className="button">Register</button>
      </form>
    </section>
  );
}
