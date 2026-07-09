import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/http";
import { useAuth } from "../context/AuthContext.jsx";

export default function Login() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [form, setForm] = useState({ email: "seller@emi.local", password: "Seller@123" });
  const [resetForm, setResetForm] = useState({ email: "", otp: "", password: "" });
  const [showReset, setShowReset] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    try {
      const { user } = await login(form.email, form.password);
      navigate(user.role === "admin" ? "/admin" : user.role === "seller" ? "/seller" : "/buyer");
    } catch (err) {
      setError(err.response?.data?.message || "Login failed");
    }
  }

  async function requestReset() {
    setError("");
    const { data } = await api.post("/auth/forgot-password", { email: resetForm.email || form.email });
    setResetForm({ ...resetForm, email: resetForm.email || form.email, otp: data.mockOtp || "" });
    setMessage(`${data.message} Demo OTP: ${data.mockOtp}`);
  }

  async function resetPassword() {
    setError("");
    setMessage("");
    try {
      await api.post("/auth/reset-password", resetForm);
      setMessage("Password reset successfully. You can log in now.");
      setShowReset(false);
      setForm({ email: resetForm.email, password: resetForm.password });
    } catch (err) {
      setError(err.response?.data?.message || "Password reset failed");
    }
  }

  return (
    <section className="auth-page">
      <form className="auth-panel" onSubmit={handleSubmit}>
        <h1>Sign in</h1>
        <p>Demo accounts: admin@emi.local, seller@emi.local, buyer@emi.local. Passwords follow Role@123.</p>
        <label>Email<input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
        <label>Password<input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
        {error && <div className="error">{error}</div>}
        {message && <div className="notice success">{message}</div>}
        <button className="button">Login</button>
        <button type="button" className="button secondary" onClick={() => setShowReset(!showReset)}>Forgot password</button>
        {showReset && (
          <div className="panel">
            <h2>Reset password</h2>
            <label>Email<input value={resetForm.email} onChange={(e) => setResetForm({ ...resetForm, email: e.target.value })} /></label>
            <button type="button" className="button tiny" onClick={requestReset}>Get mock OTP</button>
            <div>
              <label>OTP<input value={resetForm.otp} onChange={(e) => setResetForm({ ...resetForm, otp: e.target.value })} /></label>
              <label>New password<input type="password" value={resetForm.password} onChange={(e) => setResetForm({ ...resetForm, password: e.target.value })} /></label>
              <button type="button" className="button tiny" onClick={resetPassword}>Reset password</button>
            </div>
          </div>
        )}
      </form>
    </section>
  );
}
