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
    if (data.refreshToken) localStorage.setItem("emi_refresh_token", data.refreshToken);
    localStorage.setItem("emi_user", JSON.stringify(data.user));
    setToken(data.token);
    setUser(data.user);
  }

  function logout() {
    const refreshToken = localStorage.getItem("emi_refresh_token");
    if (refreshToken) api.post("/auth/logout", { refreshToken }).catch(() => {});
    localStorage.removeItem("emi_token");
    localStorage.removeItem("emi_refresh_token");
    localStorage.removeItem("emi_user");
    setToken(null);
    setUser(null);
  }

  function updateUser(nextUser) {
    localStorage.setItem("emi_user", JSON.stringify(nextUser));
    setUser(nextUser);
  }

  const value = useMemo(() => ({ token, user, login, register, logout, updateUser, isAuthenticated: Boolean(token) }), [token, user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
