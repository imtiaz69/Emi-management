import axios from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api"
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("emi_token");
  if (token && !config.headers.Authorization) config.headers.Authorization = `Bearer ${token}`;
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

export function downloadUrl(path = "") {
  if (!path || /^(?:https?:|blob:|data:)/i.test(path)) return path;

  const serverUrl = (import.meta.env.VITE_SERVER_URL || "").replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${serverUrl}${normalizedPath}`;
}

export function normalizeApiPath(path = "") {
  if (!path || /^blob:/i.test(path) || /^data:/i.test(path)) return path;

  if (/^https?:\/\//i.test(path)) {
    try {
      const requestUrl = new URL(path);
      const baseUrl = new URL(api.defaults.baseURL || "/api", window.location.origin);
      const basePath = baseUrl.pathname.replace(/\/$/, "");
      if (requestUrl.origin === baseUrl.origin && requestUrl.pathname.startsWith(`${basePath}/`)) {
        return `${requestUrl.pathname.slice(basePath.length)}${requestUrl.search}${requestUrl.hash}`;
      }
    } catch {
      return path;
    }
    return path;
  }

  return path.replace(/^\/api(?=\/|$)/, "");
}

export async function openProtectedFile(path) {
  const tab = window.open("", "_blank");
  if (tab) tab.opener = null;
  const response = await api.get(normalizeApiPath(path), { responseType: "blob" });
  const blobUrl = URL.createObjectURL(response.data);
  if (tab) {
    tab.location.href = blobUrl;
  } else {
    window.location.href = blobUrl;
  }
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}
