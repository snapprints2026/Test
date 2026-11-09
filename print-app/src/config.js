// src/config.js — every app-wide setting in ONE place.
// Values come from Vercel / .env (REACT_APP_* variables are baked in at build time).

// Backend API. Set REACT_APP_API_BASE on Vercel; the fallback is production.
export const API_BASE =
  process.env.REACT_APP_API_BASE || "https://snapprintsbackend-production.up.railway.app/api";

// Customer OTP login before upload.
// The machine decides now (admin panel → machine → "Customer login"); the page
// reads it from /machines/:id/status. This value is only used if the backend is
// an older version that doesn't send it.
export const REQUIRE_LOGIN = process.env.REACT_APP_REQUIRE_LOGIN !== "false";

// Must match the backend's limit
export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
export const MAX_FILE_SIZE_LABEL = "50 MB";

export const ALLOWED_EXTENSIONS = [
  "pdf", "doc", "docx", "txt",
  "jpg", "jpeg", "png", "gif", "bmp", "webp", "tif", "tiff",
];

// How often to poll job status after payment, and machine status
export const JOB_STATUS_POLL_MS = 3000;
export const MACHINE_STATUS_POLL_MS = 30000;
// Shop machines (Module 2): refresh printer availability more often
export const SHOP_STATUS_POLL_MS = 15000;
