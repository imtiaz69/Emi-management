import { useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api/http";
import { notifyError, notifyInfo, notifySuccess } from "../utils/toast.js";

export default function VerifyEmail() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const initialEmail = location.state?.email || searchParams.get("email") || "";
  const [email, setEmail] = useState(initialEmail);
  const [otp, setOtp] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);

  async function verifyEmail(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    setIsVerifying(true);
    try {
      await api.post("/auth/verify-email", { email, otp });
      notifySuccess("Email verified successfully. Please log in.");
      navigate("/login", { replace: true });
    } catch (err) {
      const nextMessage = err.response?.data?.message || "Unable to verify email";
      setError(nextMessage);
      notifyError(err, "Unable to verify email.");
    } finally {
      setIsVerifying(false);
    }
  }

  async function resendCode() {
    setError("");
    setMessage("");
    setIsResending(true);
    try {
      const { data } = await api.post("/auth/resend-verification", { email });
      setMessage(data.message || "Verification code sent.");
      setOtp("");
      notifyInfo(data.alreadyVerified ? "Email is already verified." : "Verification code sent.");
    } catch (err) {
      const nextMessage = err.response?.data?.message || "Unable to resend verification code";
      setError(nextMessage);
      notifyError(err, "Unable to resend verification code.");
    } finally {
      setIsResending(false);
    }
  }

  return (
    <section className="auth-page">
      <form className="auth-panel" onSubmit={verifyEmail}>
        <h1>Verify email</h1>
        <p>Enter the six-digit code sent to your email. Your account is created only after the code is verified.</p>
        <label>Email
          <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>Verification code
          <input
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="6-digit code"
          />
        </label>
        {message && <div className="notice success">{message}</div>}
        {error && <div className="error">{error}</div>}
        <button className="button" disabled={isVerifying || !email || otp.length !== 6}>
          {isVerifying ? "Verifying..." : "Verify and create account"}
        </button>
        <button className="button secondary" type="button" disabled={isResending || !email} onClick={resendCode}>
          {isResending ? "Sending..." : "Resend code"}
        </button>
        <Link className="button ghost" to="/login">Back to login</Link>
      </form>
    </section>
  );
}
