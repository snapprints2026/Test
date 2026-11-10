// src/config/env.js
// Loads .env once and exposes every setting the app needs in one place.
// Secrets are never printed — only whether they are set.
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });

const bool = (v, dflt) => (v === undefined || v === "" ? dflt : v === "true");

const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PROD = NODE_ENV === "production";
const PORT = parseInt(process.env.PORT || "5000", 10);

const env = {
  NODE_ENV,
  IS_PROD,
  PORT,

  // Public URL of this API (…/api). Handed to devices on registration and
  // used to build local-storage file links.
  // Public URL of this API (devices download files from links built with it).
  // Not set on Railway → Railway's own public domain is used.
  API_BASE_URL: (
    process.env.API_BASE_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/api` : `http://localhost:${PORT}/api`)
  ).replace(/\/+$/, ""),

  JWT_SECRET: process.env.JWT_SECRET,

  /* ── Payments ──
     PAYMENT_MODE=razorpay → real Razorpay (use rzp_test_ keys while testing)
     PAYMENT_MODE=mock     → no money moves; the print page shows a "Simulate payment"
                             button. Refused when NODE_ENV=production.
     Default: razorpay if keys are set, otherwise mock (development only). */
  RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET,
  RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET,
  PAYMENT_MODE: process.env.PAYMENT_MODE,

  /* ── File storage ──
     STORAGE_DRIVER=r2    → Cloudflare R2 (production)
     STORAGE_DRIVER=local → files saved in LOCAL_STORAGE_DIR on this computer
                            (for testing on your laptop). Default: r2 if R2 keys
                            are set, otherwise local. */
  STORAGE_DRIVER: process.env.STORAGE_DRIVER,
  LOCAL_STORAGE_DIR: path.resolve(__dirname, "../..", process.env.LOCAL_STORAGE_DIR || "local-storage"),
  R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
  R2_BUCKET: process.env.R2_BUCKET,
  R2_ENDPOINT:
    process.env.R2_ENDPOINT ||
    (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined),
  R2_FORCE_PATH_STYLE: process.env.R2_FORCE_PATH_STYLE === "true",
  R2_UPLOAD_URL_TTL_SECONDS: parseInt(process.env.R2_UPLOAD_URL_TTL_SECONDS || "600", 10),
  R2_DOWNLOAD_URL_TTL_SECONDS: parseInt(process.env.R2_DOWNLOAD_URL_TTL_SECONDS || "600", 10),

  // Files older than this are deleted by the cleanup job (unless still needed)
  UPLOAD_MAX_AGE_MINUTES: parseInt(process.env.UPLOAD_MAX_AGE_MINUTES || "30", 10),

  // Module 2: a paid shop job that no printer picked up within this time is
  // expired and refunded automatically (shop computer off, printers paused…).
  SHOP_QUEUE_EXPIRY_MINUTES: parseInt(process.env.SHOP_QUEUE_EXPIRY_MINUTES || "120", 10),

  // Module 1: how long the kiosk OTP works after payment. Unused → EXPIRED + automatic refund.
  OTP_TTL_MINUTES: parseInt(process.env.OTP_TTL_MINUTES || "30", 10),

  // Refuse payment when the machine hasn't checked in during the last 2 minutes.
  // On by default in production; off locally so you can test without a device.
  REQUIRE_MACHINE_ONLINE: bool(process.env.REQUIRE_MACHINE_ONLINE, process.env.NODE_ENV === "production"),

  // Customers can report a problem with a paid order for this long.
  ISSUE_REPORT_WINDOW_HOURS: parseInt(process.env.ISSUE_REPORT_WINDOW_HOURS || "48", 10),
  // How long an admin stays logged in (hours). Vendors and officers stay 7 days.
  ADMIN_SESSION_HOURS: Math.max(1, parseInt(process.env.ADMIN_SESSION_HOURS || "12", 10) || 12),

  /* ── Document conversion ──
     Word/text/image uploads are converted to PDF so every printer gets a PDF
     and pages are counted correctly. Word files need LibreOffice; set its path
     if `soffice` is not on PATH. Without LibreOffice, Word files are printed as
     uploaded and priced as 1 page (the old behaviour). */
  LIBREOFFICE_PATH: process.env.LIBREOFFICE_PATH || "soffice",

  // Default customer OTP login, for machines whose own setting is "Default".
  //   false → scan QR → upload → pay, no login
  //   true  → customer must verify mobile OTP first (default if unset)
  REQUIRE_CUSTOMER_LOGIN: bool(process.env.REQUIRE_CUSTOMER_LOGIN, true),

  // Old Raspberry Pi first-boot registration (POST /api/register-machine, by serial
  // number, no code). Keep true until every Pi uses a setup code, then set false.
  ALLOW_LEGACY_PI_REGISTRATION: bool(process.env.ALLOW_LEGACY_PI_REGISTRATION, true),

  // Extra allowed browser origins (comma-separated), e.g. your Vercel URLs.
  CORS_ORIGINS: (process.env.CORS_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),

  /* ── Encryption at rest ──
     64 hex characters (32 bytes). Encrypts customer documents in storage and
     the kiosk OTPs in the database; also keys the OTP hashes. Generate with:
       node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
     If unset, a key is derived from JWT_SECRET (works, but then changing
     JWT_SECRET makes files that are still waiting to print unreadable). */
  DATA_ENCRYPTION_KEY: process.env.DATA_ENCRYPTION_KEY || "",

  // Business time zone for office hours, SLA and reports (India: +05:30, no DST).
  BUSINESS_TZ_OFFSET: process.env.BUSINESS_TZ_OFFSET || "+05:30",

  // SCAN orders: the scanned PDF can be downloaded for this long, then it's deleted.
  SCAN_RESULT_TTL_MINUTES: parseInt(process.env.SCAN_RESULT_TTL_MINUTES || "60", 10),

  // A machine not heard from for this long counts as down (SLA).
  DOWNTIME_OFFLINE_MINUTES: parseInt(process.env.DOWNTIME_OFFLINE_MINUTES || "5", 10),

  /* ── DPDP Act: consent notice + grievance officer ──
     Bump CONSENT_NOTICE_VERSION whenever the privacy notice text changes. */
  CONSENT_REQUIRED: bool(process.env.CONSENT_REQUIRED, true),
  CONSENT_NOTICE_VERSION: process.env.CONSENT_NOTICE_VERSION || "2026-10",
  GRIEVANCE_NAME: process.env.GRIEVANCE_NAME || "SnapPrints Privacy Desk",
  GRIEVANCE_EMAIL: process.env.GRIEVANCE_EMAIL || "privacy@snapprints.in",
  PRIVACY_POLICY_URL: process.env.PRIVACY_POLICY_URL || "",

  /* ── Invoices / receipts (GST) ──
     SELLER_* = the business that receives the money (shown on every invoice).
     Without SELLER_GSTIN, documents are issued as receipts without GST lines.
     Prices are GST-inclusive. Ask your CA for the right rate and SAC code. */
  SELLER_NAME: process.env.SELLER_NAME || "SnapPrints",
  SELLER_GSTIN: (process.env.SELLER_GSTIN || "").trim().toUpperCase(),
  SELLER_ADDRESS: process.env.SELLER_ADDRESS || "",
  SELLER_STATE: process.env.SELLER_STATE || "Maharashtra",
  INVOICE_PREFIX: (process.env.INVOICE_PREFIX || "SP").replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 4) || "SP",
  INVOICE_GST_RATE: Number(process.env.INVOICE_GST_RATE || "18"),
  INVOICE_SAC: process.env.INVOICE_SAC || "",
  INVOICE_DUE_DAYS: parseInt(process.env.INVOICE_DUE_DAYS || "30", 10),
};

env.R2_ENABLED = !!(env.R2_ENDPOINT && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET);
if (!env.STORAGE_DRIVER) env.STORAGE_DRIVER = env.R2_ENABLED ? "r2" : "local";

const hasRazorpayKeys = !!(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
if (!env.PAYMENT_MODE) env.PAYMENT_MODE = hasRazorpayKeys ? "razorpay" : IS_PROD ? "disabled" : "mock";

/* ── Validation ── */
if (!env.JWT_SECRET) {
  console.error("❌ JWT_SECRET is not set — logins cannot work. Refusing to start.");
  process.exit(1);
}
if (env.PAYMENT_MODE === "mock" && IS_PROD) {
  console.error("❌ PAYMENT_MODE=mock is not allowed in production. Refusing to start.");
  process.exit(1);
}
if (env.STORAGE_DRIVER === "r2" && !env.R2_ENABLED) {
  console.warn("⚠️  STORAGE_DRIVER=r2 but R2 keys are missing — customers cannot upload files");
}
if (env.DATA_ENCRYPTION_KEY && !/^[0-9a-fA-F]{64}$/.test(env.DATA_ENCRYPTION_KEY)) {
  console.error("❌ DATA_ENCRYPTION_KEY must be 64 hex characters. Refusing to start.");
  process.exit(1);
}
if (!env.DATA_ENCRYPTION_KEY && IS_PROD) {
  console.warn("⚠️  DATA_ENCRYPTION_KEY is not set — using a key derived from JWT_SECRET. Set your own (see .env.example).");
}
if (!/^[+-]\d{2}:\d{2}$/.test(env.BUSINESS_TZ_OFFSET)) env.BUSINESS_TZ_OFFSET = "+05:30";

console.log("ENV CHECK — DB host:", process.env.DB_HOST || process.env.MYSQLHOST || "localhost");
console.log("ENV CHECK — payments:", env.PAYMENT_MODE === "razorpay"
  ? `Razorpay (${String(env.RAZORPAY_KEY_ID).startsWith("rzp_test_") ? "TEST keys" : "LIVE keys"})`
  : env.PAYMENT_MODE === "mock" ? "MOCK (no real money — local testing only)" : "DISABLED (no Razorpay keys)");
console.log("ENV CHECK — Razorpay webhook:", env.RAZORPAY_WEBHOOK_SECRET ? "SET" : "not set");
console.log("ENV CHECK — storage:", env.STORAGE_DRIVER === "r2"
  ? `Cloudflare R2 (bucket ${env.R2_BUCKET})` : `local folder ${env.LOCAL_STORAGE_DIR}`);
console.log("ENV CHECK — default customer login:", env.REQUIRE_CUSTOMER_LOGIN ? "required" : "off");

module.exports = env;
