import axios from "axios";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5000/api";

const axiosClient = axios.create({
  baseURL: API_BASE,
});

// Attach the staff (admin/vendor) JWT to every request if present.
axiosClient.interceptors.request.use((config) => {
  const token = localStorage.getItem("sp_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Global 401 handling — token expired/invalid, force back to login.
axiosClient.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response && err.response.status === 401) {
      localStorage.removeItem("sp_token");
      localStorage.removeItem("sp_user");
      localStorage.removeItem("sp_role");
      if (!window.location.pathname.startsWith("/login")) {
        window.location.href = "/login";
      }
    }
    return Promise.reject(err);
  }
);

export default axiosClient;

/* Download a file (PDF / CSV) from an authenticated endpoint. */
export async function downloadFile(path, fallbackName = "download") {
  const res = await axiosClient.get(path, { responseType: "blob" });
  const cd = res.headers["content-disposition"] || "";
  const m = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"/i.exec(cd);
  const name = m ? decodeURIComponent(m[1] || m[2]) : fallbackName;
  const url = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/* Error message from an axios error */
export const errMsg = (err, fallback = "Something went wrong") => err?.response?.data?.error || err?.message || fallback;
