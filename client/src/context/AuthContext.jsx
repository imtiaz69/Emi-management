import { createContext, useContext, useMemo, useState } from "react";
import { api } from "../api/http";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem("emi_token"));
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem("emi_user");
    return raw ? JSON.parse(raw) : null;
  });

  async function login(email, password) {
    const { data } = await api.post("/auth/login", { email, password });
    persist(data);
    return data;
  }

  async function register(payload) {
    const { data } = await api.post("/auth/register", payload);
    persist(data);
    return data;
  }

  function persist(data) {
    localStorage.setItem("emi_token", data.token);
    localStorage.setItem("emi_user", JSON.stringify(data.user));
    setToken(data.token);
    setUser(data.user);
  }

  function logout() {
    localStorage.removeItem("emi_token");
    localStorage.removeItem("emi_user");
    setToken(null);
    setUser(null);
  }

  const value = useMemo(() => ({ token, user, login, register, logout, isAuthenticated: Boolean(token) }), [token, user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
