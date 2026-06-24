import axios from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api"
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("emi_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export function downloadUrl(path) {
  return `${import.meta.env.VITE_SERVER_URL || ""}${path}`;
}
