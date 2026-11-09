# Deploying SnapPrints (Railway + Vercel)

Do this only after everything works on your laptop (see README.md).

| Part | Where | Root directory |
|---|---|---|
| Backend API + MySQL | Railway | `backend` |
| Customer print page | Vercel project 1 | `print-app` |
| Landing page + dashboards | Vercel project 2 | `dashboard` |
| Shop print agent | Each shop's Windows PC | `shop-agent` |

Push the whole `snapprints` folder to **one** GitHub repository. Each Railway or Vercel project points at its own sub-folder.

---

## 1. Backend on Railway

### 1.1 Service

1. Railway → your project → **+ New → GitHub Repo** → pick the repo.
2. Service → **Settings → Root Directory** → `backend`.

   `backend/railway.json` tells Railway to build with `backend/Dockerfile` (Node 22 + LibreOffice + Devanagari fonts) and to run `npm run migrate` before every deploy. The first build takes a few minutes. That's normal.
3. **Settings → Networking → Generate Domain**, for example `https://snapprints-api.up.railway.app`.

### 1.2 Database

Use your **existing** Railway MySQL so your revenue history stays. Otherwise, **+ New → Database → MySQL**.

### 1.3 Variables (service → Variables)

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `API_BASE_URL` | `https://<your-domain>/api` |
| `MYSQLHOST`, `MYSQLPORT`, `MYSQLUSER`, `MYSQLPASSWORD`, `MYSQLDATABASE` | **Add Reference** → your MySQL service (or the `DB_*` names) |
| `JWT_SECRET` | a new long random string |
| `PAYMENT_MODE` | `razorpay` |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | `rzp_test_…` first, live keys when you launch |
| `RAZORPAY_WEBHOOK_SECRET` | see 1.5 |
| `STORAGE_DRIVER` | `r2` |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | from Cloudflare R2 (same as now) |
| `REQUIRE_CUSTOMER_LOGIN` | `false` (the default for machines left on "Default") |
| `ALLOW_LEGACY_PI_REGISTRATION` | `true` until every Pi uses setup codes |
| `CORS_ORIGINS` | your two Vercel URLs / domains, comma-separated |
| `RESEND_API_KEY`, `TO_EMAIL` | demo-request emails (optional) |
| `DATA_ENCRYPTION_KEY` | **64 hex characters** — `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Encrypts stored documents and kiosk OTPs. Set it once; changing it makes files waiting to print unreadable. Keep a copy in a password manager. |
| `BUSINESS_TZ_OFFSET` | `+05:30` |
| `CONSENT_REQUIRED`, `CONSENT_NOTICE_VERSION` | `true`, `2026-10` (bump the version when you change the notice) |
| `GRIEVANCE_NAME`, `GRIEVANCE_EMAIL`, `PRIVACY_POLICY_URL` | your DPDP grievance officer and policy page |
| `SELLER_NAME`, `SELLER_GSTIN`, `SELLER_ADDRESS`, `SELLER_STATE` | the business on the invoices. Without `SELLER_GSTIN`, receipts carry no GST lines. |
| `INVOICE_PREFIX`, `INVOICE_GST_RATE`, `INVOICE_SAC`, `INVOICE_DUE_DAYS` | `SP`, `18`, your SAC code, `30` — confirm with your CA |
| `SCAN_RESULT_TTL_MINUTES`, `DOWNTIME_OFFLINE_MINUTES` | `60`, `5` (optional) |
| `OTP_TTL_MINUTES` | `30` — how long a kiosk OTP works; unused → refunded automatically |
| `REQUIRE_MACHINE_ONLINE` | `true` in production (default) — no payment while the machine is offline |
| `ISSUE_REPORT_WINDOW_HOURS` | `48` — how long customers can report a problem with an order |

The server refuses to start with `PAYMENT_MODE=mock` in production, so test money can never be used on the live site by mistake.

### 1.4 Upgrade the database (once, and after future updates)

The migration adds the new tables and columns. It also hashes existing OTPs, empties the old plain-text API keys and OTP columns, masks stored UPI IDs and makes existing admins SUPER_ADMIN. Revenue history is not changed. **Take a database backup first** (Railway → MySQL → Backups). Two ways to run it:

- From your laptop: put the Railway MySQL **public** connection details into `backend/.env` (`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`), then run:
  ```bash
  cd backend && npm run migrate
  ```
- Or let Railway do it: `railway.json` already sets the pre-deploy command `npm run migrate`. It runs on every deploy, which is safe because it only adds what's missing.

After a week live without problems, remove the emptied legacy columns (`customers.otp`, `print_job_tokens.otp`/`qr_token`, `machines.api_key_plain`):

```bash
cd backend && node scripts/migrate.js --drop-legacy
```

If this is a brand-new database, also create your admin:

```bash
npm run create-admin -- "Your Name" you@example.com "StrongPassword"
```

### 1.5 Razorpay webhook

Without the webhook, an order paid on a phone that then closes the page would never print.

1. Razorpay Dashboard → **Account & Settings → Webhooks → + Add New Webhook**.
2. URL: `https://<your-domain>/api/payments/razorpay-webhook`
3. Secret: any random string. Put the same value in `RAZORPAY_WEBHOOK_SECRET` on Railway.
4. Events: **payment.captured** and **order.paid**.

Set this up separately for Test mode and Live mode; each has its own webhooks.

### 1.6 Check

Open `https://<your-domain>/health`, which should return `{"status":"ok"}`. The Railway logs show `ENV CHECK — payments: Razorpay (TEST keys)` and `storage: Cloudflare R2`.

---

## 2. Customer print page on Vercel

1. Vercel → **Add New → Project** → import the repo → **Root Directory**: `print-app`. The framework preset is detected as Create React App.
2. Environment variable: `REACT_APP_API_BASE` = `https://<railway-domain>/api`
3. Deploy. Optionally add your domain, e.g. `print.snapprints.in`, and add it to `CORS_ORIGINS` on Railway.

The QR code on each machine or shop counter is `https://<print-domain>/?machine=MH1001`.

## 3. Dashboard on Vercel

1. **Add New → Project** → same repo → **Root Directory**: `dashboard`. The framework preset is detected as Vite.
2. Environment variable: `VITE_API_BASE` = `https://<railway-domain>/api`
3. Deploy. Optionally add `snapprints.in`.

**Admin API routes now need an admin login.** Before, some (`/admin/stats`, `/admin/createmachine`, …) were open to anyone. The dashboard already sends the token, so nothing else is needed. Just log in again after deploying.

---

### 1.7 Cloudflare R2

- Add a lifecycle rule on the bucket: delete objects older than **1 day**. The server already deletes files after printing; this catches anything missed.
- Files are stored encrypted (AES-256-GCM). Devices download through `/api/files/get` on the backend, which decrypts on the fly, so R2 never needs public access.
- For government contracts that need data in India, pick the R2 jurisdiction and Railway region accordingly.

## 4. Install a new xerox shop (Module 2)

1. **Admin → Vendors**: create the vendor (or open an existing one) and tick **Module 2 — Shop computer**.
2. **Admin → Machines → + Create Machine**: choose Module 2 and the vendor, then copy the **setup code**. It works once and is valid for 48 hours.
3. **On the shop's Windows PC:**
   1. Install **Node.js LTS** from nodejs.org.
   2. Install each copier's printer driver, and print a Windows test page from each one.
   3. Copy the `shop-agent` folder to the PC (e.g. `C:\SnapPrints\shop-agent`).
   4. Open a terminal in that folder and run `npm install`, then `npm run setup`.

      Enter the server address `https://<railway-domain>/api` and the setup code. Answer **n** to dry-run, then pick the copiers and say which one is colour, double-sided and A3.
   5. Double-click `start-agent.bat`. The shop screen opens at http://localhost:7300.
   6. Double-click `install-autostart.bat` so the agent starts every time the PC logs in.
4. Print the QR code `https://<print-domain>/?machine=<MACHINE_ID>` and place it at the counter.
5. Do a ₹2 test order with real money and check that it comes out of the right copier.

PC settings at the shop:

- Turn off sleep (Settings → System → Power → Screen and sleep → **Never** when plugged in).
- Windows needs to log in automatically after a power cut, or someone has to log in each morning.
- In the copier's driver, set its default tray to A4. If you said it has A3, load A3 in a second tray.

## 5. Raspberry Pis (Module 1)

The Pi app is now part of the project (`kiosk/`, version 1.1). **Existing Pis keep working without an update**: all `/api/kiosk/*` routes and `/api/register-machine` work as before, and their saved API key stays valid (the migration only empties the old plain-text copy on the server).

Update a Pi (copy the new `kiosk/` folder, keep its `config.json`, run `bash setup-pi.sh`) to get:

- registration with a **setup code** (`SETUP_CODE` in `config.json`) instead of the serial number;
- **real paper status** from CUPS, so payments stop while the printer is out of paper;
- **photocopy and scan** orders on a multifunction printer (screen shows *Scan page / Finish*).

Keep `ALLOW_LEGACY_PI_REGISTRATION=true` until every Pi has the new app, then set it to `false`.

Two differences:

- Word, text and image uploads now reach the Pi as a **PDF** (the `fileName` ends in `.pdf`). If the Pi software chose how to print by file extension, it now always gets a PDF, which is simpler.
- New Pis can register with a setup code instead of the serial number: `POST /api/devices/register { setupCode, deviceName }` → `{ MACHINE_ID, API_KEY, API_BASE, MODULE }`. When every Pi does this, set `ALLOW_LEGACY_PI_REGISTRATION=false`. The old route hands out API keys without any check.

### Kiosk firmware: new fields (optional, backwards-compatible)

- `POST /api/kiosk/heartbeat` accepts `power_source` (`MAINS`/`UPS`), `ups_battery_pct` and `door_open`. They raise ON_UPS / UPS_LOW / DOOR_OPEN alerts.
- `POST /api/kiosk/unlock` now also returns `jobType` (`PRINT`, `FORM`, `COPY`, `SCAN`) and `pages`.
  - `PRINT` / `FORM`: download and print as before.
  - `COPY`: nothing to download. Show "copy `pages` pages × `copies`", then call `mark-printed`.
  - `SCAN`: the response has `scanUploadUrl`. PUT the scanned PDF there, then call `mark-printed`.
  - Old firmware that ignores `jobType` keeps working on machines that only offer Print and Forms (the default).

### Shop agent 1.1

Copy the new `shop-agent` folder to each shop PC (keep its `config.json`) and run `npm install`. Version 1.1 shows photocopy and scan orders on the shop screen with **Start / Done / Upload scan** buttons. Version 1.0 keeps printing normal orders but ignores photocopy and scan.

## 6. Government offices

See [GOVERNMENT.md](GOVERNMENT.md) for the setup in the dashboard, hardware, GeM / GST / DPDP / CERT-In notes and the breach process.

## 7. Go-live checklist

- [ ] Railway: `NODE_ENV=production`, `PAYMENT_MODE=razorpay` with **live** keys, and a new `JWT_SECRET`
- [ ] Razorpay **live-mode** webhook added and its secret set
- [ ] `npm run migrate` ran against the production database
- [ ] Both Vercel projects point at the Railway URL; both domains are in `CORS_ORIGINS`
- [ ] Test order on one kiosk and on one shop with real money; a failed print was refunded
- [ ] A real SMS gateway is connected before you switch customer login on anywhere. `sendOtpSms` in `backend/src/routes/auth.routes.js` is still a mock (in production it logs only the masked number, never the OTP).
- [ ] `DATA_ENCRYPTION_KEY` set and saved in a password manager
- [ ] `SELLER_GSTIN`, `INVOICE_SAC` and the GST rate confirmed with your CA
- [ ] Database backup taken before the first migration
- [ ] Log in once as admin → **Admin users**: give each team member their own login and role (FINANCE, SUPPORT, VIEWER)
- [ ] `node scripts/migrate.js --drop-legacy` after a week without problems
