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

export async function openProtectedFile(path) {
  const tab = window.open("", "_blank");
  if (tab) tab.opener = null;
  const response = await api.get(path, { responseType: "blob" });
  const blobUrl = URL.createObjectURL(response.data);
  if (tab) {
    tab.location.href = blobUrl;
  } else {
    window.location.href = blobUrl;
  }
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}
