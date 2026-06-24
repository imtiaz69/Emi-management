import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./context/AuthContext.jsx";
import Layout from "./components/Layout.jsx";
import Home from "./pages/Home.jsx";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import SellerDashboard from "./pages/SellerDashboard.jsx";
import Marketplace from "./pages/Marketplace.jsx";
import BuyerPortal from "./pages/BuyerPortal.jsx";
import LoanDetails from "./pages/LoanDetails.jsx";
import AdminPanel from "./pages/AdminPanel.jsx";

function Protected({ roles, children }) {
  const { user, isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user?.role)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/marketplace" element={<Marketplace />} />
          <Route
            path="/seller"
            element={
              <Protected roles={["seller"]}>
                <SellerDashboard />
              </Protected>
            }
          />
          <Route
            path="/buyer"
            element={
              <Protected roles={["buyer"]}>
                <BuyerPortal />
              </Protected>
            }
          />
          <Route
            path="/loans/:id"
            element={
              <Protected>
                <LoanDetails />
              </Protected>
            }
          />
          <Route
            path="/admin"
            element={
              <Protected roles={["admin"]}>
                <AdminPanel />
              </Protected>
            }
          />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
