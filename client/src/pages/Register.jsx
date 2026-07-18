import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2, ShieldCheck, Store, UserRound } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import signupIllustration from "../assets/signup.svg";
import { notifyError, notifySuccess, notifyWarning } from "../utils/toast.js";

export default function Register() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const defaultRole = searchParams.get("role") === "seller" ? "seller" : "buyer";
  const { register } = useAuth();
  const [role, setRole] = useState(defaultRole);
  const [error, setError] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("User@123");
  const [agreedToTerms, setAgreedToTerms] = useState(false);
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
    if (form.password !== confirmPassword) {
      setError("Passwords do not match.");
      notifyWarning("Please enter matching passwords.");
      return;
    }
    if (!agreedToTerms) {
      setError("Please agree to the platform terms and privacy notice.");
      notifyWarning("Please accept the registration terms.");
      return;
    }
    try {
      const data = await register({ ...form, role, ownerName: form.name });
      const email = data.email || form.email;
      notifySuccess("Verification code sent. Check your email to finish creating your account.");
      navigate(`/verify-email?email=${encodeURIComponent(email)}`, { state: { email } });
    } catch (err) {
      setError(err.response?.data?.message || "Registration failed");
      notifyError(err, "Registration failed");
    }
  }

  return (
    <section className="register-page">
      <div className="register-shell">
        <form className="register-form-panel" onSubmit={handleSubmit}>
          <div className="register-heading">
            <span>Get started</span>
            <h1>Create your account</h1>
            <p>Choose how you will use FinanceLend and enter your account details.</p>
          </div>

          <div className="segmented register-role-switch" aria-label="Account type">
            <button type="button" className={role === "buyer" ? "active" : ""} onClick={() => setRole("buyer")}>
              <UserRound size={17} /> Buyer
            </button>
            <button type="button" className={role === "seller" ? "active" : ""} onClick={() => setRole("seller")}>
              <Store size={17} /> Seller
            </button>
          </div>

          <div className="form-grid register-fields">
            <label>Full name
              <input required autoComplete="name" placeholder="Enter your full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label>Email address
              <input required type="email" autoComplete="email" placeholder="name@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </label>
            <label>Phone number
              <input required autoComplete="tel" placeholder="01XXXXXXXXX" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </label>
            <label>Address
              <input autoComplete="street-address" placeholder="Enter your address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </label>
            <label>Password
              <input required type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </label>
            <label>Confirm password
              <input required type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            </label>
            {role === "seller" && (
              <>
                <label>Shop name
                  <input required placeholder="Enter your business name" value={form.shopName} onChange={(e) => setForm({ ...form, shopName: e.target.value })} />
                </label>
                <label>Trade license number
                  <input placeholder="Enter your trade license" value={form.tradeLicenseNo} onChange={(e) => setForm({ ...form, tradeLicenseNo: e.target.value })} />
                </label>
              </>
            )}
          </div>

          <label className="inline-check register-terms">
            <input type="checkbox" required checked={agreedToTerms} onChange={(e) => setAgreedToTerms(e.target.checked)} />
            <span>I agree to the FinanceLend platform terms and privacy notice.</span>
          </label>

          {error && <div className="error">{error}</div>}
          <button className="button register-submit">Create account</button>
          <p className="register-login">Already have an account? <Link to="/login">Sign in</Link></p>
        </form>

        <aside className="register-visual-panel" aria-label="Secure FinanceLend registration">
          <div className="register-visual-copy">
            <span>Secure onboarding</span>
            <h2>Start every EMI journey with confidence.</h2>
            <p>Create one protected account for shopping, lending, KYC review, and repayment tracking.</p>
          </div>
          <img src={signupIllustration} alt="Secure account registration illustration" />
          <div className="register-trust-points">
            <span><ShieldCheck size={18} /> Protected identity and KYC workflows</span>
            <span><CheckCircle2 size={18} /> Clear access for buyers and sellers</span>
          </div>
        </aside>
      </div>
    </section>
  );
}
