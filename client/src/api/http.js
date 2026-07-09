import axios from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api"
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("emi_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const refreshToken = localStorage.getItem("emi_refresh_token");
    if (error.response?.status === 401 && refreshToken && original && !original.__retry && !original.url?.includes("/auth/refresh")) {
      original.__retry = true;
      const { data } = await api.post("/auth/refresh", { refreshToken });
      localStorage.setItem("emi_token", data.token);
      localStorage.setItem("emi_refresh_token", data.refreshToken);
      localStorage.setItem("emi_user", JSON.stringify(data.user));
      original.headers.Authorization = `Bearer ${data.token}`;
      return api(original);
    }
    return Promise.reject(error);
  }
);

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
