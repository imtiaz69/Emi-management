import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import { useAuth } from "./context/AuthContext.jsx";
import Layout from "./components/Layout.jsx";
import Home from "./pages/Home.jsx";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import SellerDashboard from "./pages/SellerDashboard.jsx";
import Marketplace from "./pages/Marketplace.jsx";
import ProductDetails from "./pages/ProductDetails.jsx";
import Cart from "./pages/Cart.jsx";
import Checkout from "./pages/Checkout.jsx";
import Orders from "./pages/Orders.jsx";
import OrderDetails from "./pages/OrderDetails.jsx";
import BuyerPortal from "./pages/BuyerPortal.jsx";
import BuyerTrustProfile from "./pages/BuyerTrustProfile.jsx";
import LoanDetails from "./pages/LoanDetails.jsx";
import AdminPanel from "./pages/AdminPanel.jsx";
import SellerPending from "./pages/SellerPending.jsx";
import AccountSettings from "./pages/AccountSettings.jsx";
import SellerStoreProfile from "./pages/SellerStoreProfile.jsx";

function Protected({ roles, requireActiveSeller = false, children }) {
  const { user, isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user?.role)) return <Navigate to="/" replace />;
  if (requireActiveSeller && user?.role === "seller" && user.status !== "active") return <Navigate to="/seller/pending" replace />;
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
          <Route path="/products/:id" element={<ProductDetails />} />
          <Route path="/stores/:sellerId" element={<SellerStoreProfile />} />
          <Route
            path="/cart"
            element={
              <Protected roles={["buyer"]}>
                <Cart />
              </Protected>
            }
          />
          <Route
            path="/checkout"
            element={
              <Protected roles={["buyer"]}>
                <Checkout />
              </Protected>
            }
          />
          <Route
            path="/orders"
            element={
              <Protected roles={["buyer", "seller", "admin"]}>
                <Orders />
              </Protected>
            }
          />
          <Route
            path="/orders/:id"
            element={
              <Protected roles={["buyer", "seller", "admin"]}>
                <OrderDetails />
              </Protected>
            }
          />
          <Route
            path="/seller"
            element={
              <Protected roles={["seller"]} requireActiveSeller>
                <SellerDashboard />
              </Protected>
            }
          />
          <Route
            path="/seller/pending"
            element={
              <Protected roles={["seller"]}>
                <SellerPending />
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
            path="/buyers/:buyerId"
            element={
              <Protected roles={["seller", "admin"]}>
                <BuyerTrustProfile />
              </Protected>
            }
          />
          <Route
            path="/account"
            element={
              <Protected>
                <AccountSettings />
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
      <ToastContainer position="top-right" autoClose={2800} newestOnTop closeOnClick pauseOnFocusLoss pauseOnHover theme="colored" />
    </BrowserRouter>
  );
}
