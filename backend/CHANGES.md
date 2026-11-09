# SnapPrints backend — changes

## v4: merged with the live code + Photo of card (latest)

This version combines the government / PSU release (v3) with everything that was only in the live repositories (Oct 2026), and adds Photo of card. Run `npm run migrate` — it upgrades the live database in place (tested on a copy shaped like it).

### From the live code
- **Issues & refunds** (`issue.controller.js`, `refund.service.js`, table `job_issues`): customer *Report a problem* → auto refund for failed / expired orders, admin queue for printed ones; support search by reference code, UPI reference, phone, job or payment ID.
- **One refund path** for everything (printer error, expired OTP, shop order not printed in time, admin, approved issue). Safe to call twice; refunded orders stop counting as revenue; department-billed and free orders are never refunded.
- **Reference codes** (`SP-7KQ2MX`), **UTR** and payer phone saved on payment (checkout and webhook).
- **Automatic refund of unused kiosk OTPs** (`OTP_TTL_MINUTES`, default 30) with a 7-day safety net; jobs stuck in PRINTING for 15 minutes open a case.
- **No payment while the machine is offline** (`REQUIRE_MACHINE_ONLINE`).
- **Machine location details**: campus / building / floor / spot / landmark, map pin, on-site contact, opening hours and weekly off (kept in step with the office days used for SLA). Machine IDs `SPK1001` / `SPS1001`.
- **Vendor details**: institution type (now also Government office, Bank, PSU office — which sets the segment), designation, alternate phone, PAN, billing address.
- LibreOffice conversions limited to 2 at a time; UTF-8 text files.
- Public demo-request form from the live site (rate-limited).
- Legacy Pi registration claims machines safely when two Pis boot at once; `mark-failed` accepts the Pi's `error` field.

### New
- **Photo of card** in the print page (no backend change needed — the page arrives as an image upload; `print_jobs.source = 'CARD'` marks it for reports).
- Segment defaults: Education is strict privacy by default (Retail standard); new machines get services by segment (Education print, Retail print + photocopy + scan, Government / PSU print + forms).
- Raspberry Pi app 1.1 in `../kiosk` (setup codes, CUPS paper status, photocopy / scan).

### Database
New table `job_issues`. New columns: `print_jobs.source, ref_code (unique), utr, payer_contact, refund_id, refund_amount, refund_status, refund_reason, refunded_at`; `locations.weekly_off, campus_name, building, floor, spot, landmark, contact_name, contact_phone`; `vendors.institution_type, contact_designation, alt_phone, pan_number, billing_address`. Live ENUM columns (`institution_type`, `refund_status`) become VARCHAR.

## v3: Government / PSU customer segment

Existing machines, kiosks and shop agents keep working. Run `npm run migrate` (Railway does it before each deploy). See `../GOVERNMENT.md` for the product side.

### Database

New tables: `organizations` (office tree), `officers`, `contracts`, `form_templates`, `pricing_rules`, `consents`, `downtime_events`, `sla_reports`, `support_tickets`, `support_ticket_updates`, `invoice_sequences`, `invoices`, `settlements`.

| Table | New / changed |
|---|---|
| `admin_users` | `role` (SUPER_ADMIN, ADMIN, FINANCE, SUPPORT, VIEWER) — existing admins become SUPER_ADMIN |
| `vendors` | `segment`, `strict_privacy`, `address`, `state` |
| `customers` | `otp_hash`, `otp_attempts`, `deleted_at` (plain `otp` emptied) |
| `locations` | `open_time`, `close_time`, `open_days` (SLA office hours) |
| `machines` | `organization_id`, `contract_id`, `enabled_job_types`, `billing_mode`, `staff_pin_hash`, `default_language`, `asset_tag`, `printer_model`, `installed_at`; `api_key_plain` emptied |
| `print_jobs` | `organization_id`, `contract_id`, `job_type` (PRINT/FORM/COPY/SCAN), `form_template_id`, `billing` (CUSTOMER/DEPARTMENT), `file_encrypted`, `file_deleted_at`, `result_path`, `result_expires_at`, `unit_rate`, `pricing_rule_id`. Strict-privacy jobs store "Document" instead of the file name. `payment_details` keeps only network / last 4 / masked UPI ID. |
| `print_job_tokens` | `otp_hash`, `otp_enc`, `qr_hash`, `qr_enc` (plain columns emptied) |
| `machine_heartbeat_logs` | `power_source`, `ups_battery_pct`, `door_open` |
| `audit_logs` | `action_type` is VARCHAR(50); `actor_type`, `actor_id`, `ip` |

`node scripts/migrate.js --drop-legacy` removes the emptied columns once you are happy.

### Security

- OTPs and QR tokens are stored as HMAC hashes; the kiosk copy is AES-256-GCM encrypted. Login OTP locks after 5 wrong tries.
- Uploaded documents are encrypted at rest (`DATA_ENCRYPTION_KEY`). Devices download through signed, expiring `/api/files/get` links that decrypt on the fly. `file_deleted_at` + a `FILE_DELETED` audit row prove deletion.
- Admin role and status are read from the database on every request (a disabled admin is locked out at once). Role guards: finance, support, manage, refund, super-admin.
- Officers (`/api/officer/*`) are read-only and limited to their organisation subtree.
- Rate limits on login, OTP and device registration; security headers on every response.
- DPDP: consent recorded before upload (`/api/jobs/upload-url` needs `consent: true` when `CONSENT_REQUIRED`), `DELETE /api/customers/me`.

### Pricing

`pricing_rules` by scope MACHINE > CONTRACT > GLOBAL, then the most specific match on service / colour / size / sides. New rules need approval by a different admin. Defaults when nothing matches: B&W ₹2 (A4) / ₹4 (A3), colour ₹5 / ₹10, scan ₹3 per page. A unit is a page, a sheet when double-sided, or a page scanned.

### New endpoints

| | |
|---|---|
| `GET /api/machines/:id/forms`, `POST /api/jobs/form-jobs` | form catalogue orders |
| `POST /api/jobs/service-jobs` | photocopy / scan orders (pages × copies) |
| `POST /api/jobs/:id/submit-billed` | department-billed job, with the machine's staff code |
| `GET /api/jobs/:id/scan`, `GET /api/jobs/:id/receipt` | scanned PDF link, receipt PDF |
| `POST /api/support/tickets` | citizen "report a problem" |
| `PUT /api/files/scan?…` | device uploads a scanned PDF (signed URL) |
| `/api/agent/jobs/:id/start`, `…/scan-url` | shop agent: manual COPY/SCAN jobs |
| `/api/admin/organizations`, `/officers`, `/contracts`, `/forms`, `/pricing-rules`, `/invoices`, `/settlements`, `/sla`, `/downtime`, `/tickets`, `/audit`, `/admin-users` | admin |
| `/api/officer/*` | officer portal |
| `/api/vendor/tickets`, `/api/vendor/settlements` | vendor |

### Background jobs

- `jobs/sla.cron.js`: every 5 minutes opens/closes downtime events (offline, out of paper, printer error); at 00:30 IST recomputes the month's SLA reports.
- `jobs/cleanup.cron.js`: also deletes expired scan results.

### Invoices

`services/invoice.service.js`: GST-inclusive amounts split into CGST + SGST (same state) or IGST. Numbers are gap-free per financial year and type, e.g. `SP/26-27/R000001` (citizen receipt), `SP/26-27/D000001` (department), `SP/26-27/M000001` (manual). PDF rendered with pdf-lib.

### Deployment

Railway now builds from `Dockerfile` (`node:22-bookworm-slim` + LibreOffice + Noto fonts) instead of Nixpacks, with `npm run migrate` as the pre-deploy command. The `"snapprints": "file:.."` dependency was removed from every package.json.

## v2: Module 2 (shop computer) + both modules in one project

Every existing machine stays **Module 1 (KIOSK)**, and every existing API path and response still works, so the current Raspberry Pis need no update.

### Database (`npm run migrate`, safe to repeat)

| Table | New |
|---|---|
| `vendors` | `allowed_modules` (`KIOSK`, `SHOP` or `KIOSK,SHOP`) |
| `machines` | `module` (`KIOSK`/`SHOP`), `require_login` (NULL = server default), `device_name`, `setup_code_hash`, `setup_code_expires_at` |
| `printers` | new: the copiers of a shop machine (kind BW/COLOR, duplex, paper sizes, status, enabled) |
| `print_jobs` | `printer_id`, `order_code` (pickup code), `fail_reason` |

All DATETIMEs are now read and written as UTC (`timezone: "Z"` + `SET time_zone='+00:00'`). Before, "online in the last 2 minutes" broke when MySQL and Node used different time zones.

### Flow after payment (`services/fulfilment.service.js`)

- **KIOSK:** OTP + QR as before.
- **SHOP:** pickup code, then socket `job_ready` to the shop computer.
- `markPaid()` is idempotent. The browser (`verify-payment`) and the new **Razorpay webhook** (`POST /api/payments/razorpay-webhook`, which checks the signature and the amount) can both report a payment; the first one does the work.

### New endpoints

| | |
|---|---|
| `POST /api/devices/register` | `{ setupCode, deviceName }` → `{ MACHINE_ID, API_KEY, API_BASE, MODULE }` (both modules, rate-limited) |
| `/api/agent/*` | shop computer (signed like the kiosk, SHOP machines only): heartbeat, printers, jobs/pending, jobs/:id/claim, printed, failed, requeue, recent |
| `PATCH /api/admin/machines/:id/settings` | `{ module, requireLogin }`. Changing the module is refused while there are unfinished paid orders. |
| `POST /api/admin/machines/:id/setup-code` | new one-time setup code |
| `PATCH /api/admin/printers/:id`, `PATCH /api/vendor/printers/:id` | pause / resume a printer |
| `PATCH /api/admin/vendors/:id` | `{ allowedModules, status }` |
| `GET /api/vendor/machines/:id/printers`, `/orders` | vendor's shop view |
| `POST /api/mock-pay` | local testing only (`PAYMENT_MODE=mock`, refused in production) |

### Changed behaviour

- **All `/api/admin/*` routes now need an admin token.** Before, stats, createmachine, machines, revenue and others were open.
- `createmachine` takes `module`, `vendorId` and `requireLogin`, and returns a **setup code** instead of an API key. That old API key never worked anyway: the machine stayed PENDING until the Pi registered.
- A machine can only be assigned to a vendor who bought its module.
- **Customer login is per machine** (`machines.require_login`, falling back to `REQUIRE_CUSTOMER_LOGIN`), and is checked at upload-url and create-payment. An expired token now gets a 401 instead of silently becoming a guest.
- **Every upload is converted to PDF** (`services/convert.service.js`): Word via LibreOffice, images via pdf-lib/sharp, text. Word files are now priced by their real page count instead of 1 page. Devices get a `.pdf` file name.
- `/api/machines/:id/status` adds `module`, `require_login`, `capabilities` (what the shop's printers can do), `name`, `location_name` and `payment_mode`.
- `/api/job-status/:id` adds `module`, plus `orderCode`, `printerName`, `queueAhead` and `failReason`.
- The print options (colour, side, size, copies) are validated against what the shop's printers support.
- Cleanup cron: paid shop orders nobody printed within `SHOP_QUEUE_EXPIRY_MINUTES` are failed and refunded, and their files are kept while they wait.
- `/api/register-machine` (legacy Pi, by serial) only hands out KIOSK machines, and can be switched off with `ALLOW_LEGACY_PI_REGISTRATION=false`.
- Admin refunds go through `payment.service`, so they also work in mock mode.

### Laptop testing

- `STORAGE_DRIVER=local`: this server plays R2 (`/api/local-storage/put|get` with signed, expiring links).
- `PAYMENT_MODE=mock`: no Razorpay needed.
- `DB_SSL`: SSL is used for remote hosts and not for localhost.
- `npm run seed:dev` creates a test admin, vendor and two machines. `npm run kiosk:sim` pretends to be a Pi.

---

## v1 history

## Cloudflare R2 file storage (latest)

Customer documents no longer touch Railway's disk. They go **phone → R2 → Raspberry Pi** using short-lived signed links, so a redeploy can't lose a paid customer's file and Railway bandwidth stays near zero.

### New upload flow (frontend already updated)

| Step | Call | What happens |
|---|---|---|
| 1 | `POST /api/upload-url` `{ fileName, fileSize, machineId, color, copies, paperSize, printSide }` | Checks type, size (≤ 50 MB), machine and copies. Creates the job (0 pages, can't be paid yet). Returns `{ jobId, uploadUrl, contentType, expiresIn }`. |
| 2 | `PUT <uploadUrl>` with header `Content-Type: <contentType>` | Browser uploads straight to R2. |
| 3 | `POST /api/jobs/:jobId/complete-upload` | Checks the file arrived and its size, counts PDF pages, returns `{ jobId, pages }`. Safe to retry. |

`POST /api/upload-job` (old multipart upload) now returns `410` asking the customer to refresh. `create-payment` refuses jobs whose upload isn't finished.

### Kiosk download

- `POST /api/kiosk/unlock` now also returns **`downloadUrl`** — a plain R2 link (10 min). The Pi just GETs it, no headers.
- `GET /api/kiosk/jobs/:jobId/file` (signed kiosk headers) still works: it **redirects (302)** to the R2 link, so Pi code that follows redirects keeps working. Add `?format=json` to get `{ url, fileName, expiresIn }` instead.
- The old public `/uploads/<file>` path and `LEGACY_PUBLIC_UPLOADS` are gone.

### Deleting files

- After `mark-printed` / `mark-failed` the R2 file is deleted and `file_path` set to NULL (row kept).
- The 5-minute cleanup job finds files **through the database** (no bucket listing — deletes are free on R2, listing is not): abandoned unpaid uploads after 30 min, and any file older than `UPLOAD_MAX_AGE_MINUTES` unless the job is PRINTING or PAID with a valid OTP.
- The bucket's lifecycle rule (delete after 1 day) is the safety net.

### Other

- `multer` removed; `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` added.
- Fixed PDF page counting for small files ("bad XRef entry" when Node handed pdf.js a pooled Buffer).
- New settings: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (+ optional TTLs). Remove `UPLOAD_DIR` and `LEGACY_PUBLIC_UPLOADS` from Railway.

---

## Earlier: restructure & fixes

All API paths are the same as before, and so is every route's response shape, apart from the extra fields noted below.
Entry point is now `src/server.js` (`npm start`).

## Folder structure

```
src/
  server.js            HTTP server + socket + cron + listen
  app.js               Express app, CORS, routes, JSON error handler
  config/              env.js, cors.js, razorpay.js, fileTypes.js
  middleware/          verifyMachine, verifyCustomerToken, verifyStaffToken, errorHandler
  routes/              kiosk, job, payment, machine (+ admin, auth, customer, vendor, demo)
  controllers/         kiosk, job, payment, machine (+ admin, vendor)
  services/            pricing, audit, payment, pdf, file, storage (R2)
  jobs/cleanup.cron.js
  database/db.js
  socket/socket.js
scripts/               create-admin.js, generate-daily-stats.js
```

## What changed

| # | Change |
|---|---|
| 1 | **Login always sends an OTP.** A known phone number no longer logs in by itself. Skipping the OTP next time now works through the saved 30-day token. |
| 2 | **Job rows are never deleted** once printed, failed or expired, so the day, month, 6-month and year revenue figures stay correct. Only the file is deleted, and `file_path` is set to NULL. |
| 3 | **`/uploads` is no longer public.** Kiosks download through `GET /api/kiosk/jobs/:jobId/file` using signed headers. That route only works for the kiosk's own job and only while the job is PAID or PRINTING. |
| 3 | **Socket:** `payment_success` no longer contains `filePath`. Kiosks can join a private room with `kiosk:join`. Socket CORS now uses the same allowed-origin list as the API, not `*`. |
| 3 | **File cleanup:** every 5 minutes, any upload older than 30 minutes is deleted unless its job is printing or paid with a valid OTP. Abandoned unpaid uploads (CREATED for more than 30 minutes) are removed together with their file. |
| 3 | Uploaded files get random names. The original name is kept only in the DB. |
| 4 | **Job IDs are random** (`JOB_` + 16 hex characters). |
| 4 | **Job routes need the customer's login** and only work for that customer's own jobs: `upload-job`, `job-summary`, `PATCH job`, `job-status`, `create-payment`. |
| – | `mark-printed` and `mark-failed` only work for the calling kiosk's own jobs. `mark-failed` also deletes the file. |
| – | The Razorpay secret is no longer printed in logs. There is one shared Razorpay client, and the broken `razorpay.js` is gone. |
| – | Errors are always JSON, including wrong file type, files over 50 MB and unknown routes. |
| – | Uploads are validated: the file must be present, copies must be 1–100, and the machine must exist and be active. |
| – | Heartbeats are no longer copied into `audit_logs`. They are already stored in `machine_heartbeat_logs`. |
| – | OTPs use `crypto.randomInt`. Payment signatures are compared in constant time. |
| – | `generate-daily-stats.js` uses the normal DB settings instead of fixed root/root login details. |

## Demo mode (no OTP)

One Railway variable switches customer login on and off. No code needs to be commented out.

| `REQUIRE_CUSTOMER_LOGIN` | Behaviour |
|---|---|
| `false` (demo) | Scan QR, upload, pay, print. No login needed. Jobs are saved with `customer_id = NULL`. |
| `true` or not set (launch) | The customer must verify a mobile OTP before uploading. |

- **Where it is used:** `customerAuth` in `src/middleware/verifyCustomerToken.js`. It is applied in `job.routes.js` and `payment.routes.js`.
- **Demo-mode privacy:** a guest can only open guest jobs, using the random jobId. A logged-in customer's jobs stay private.

## Frontend changes needed

1. **Send the token on job and payment calls.** Add `Authorization: Bearer <token>` to `upload-job`, `job-summary/:id`, `PATCH job/:id`, `job-status/:id` and `create-payment`.
2. **Skip login for returning users.** When the upload page opens (`?mh=MH100`), if a token is saved, call `GET /api/customer/me`.
   - **200:** go straight to upload.
   - **401:** show the mobile number screen.
3. **Login screen.** `/api/auth/login` now always returns `{ status: "otp_sent" }`. Show the OTP box every time.

## Raspberry Pi change needed

After unlock, download from `fileUrl` (new field in the unlock response) and send the **same signed headers** as other kiosk calls. For a GET request the body is `{}`, so sign `machineId + timestamp + "{}"`.

```python
import time, hmac, hashlib, requests

def signed_headers(machine_id, api_key, body_json="{}"):
    ts = str(int(time.time() * 1000))
    sig = hmac.new(api_key.encode(), (machine_id + ts + body_json).encode(), hashlib.sha256).hexdigest()
    return {"x-machine-id": machine_id, "x-timestamp": ts, "x-api-key": api_key, "x-signature": sig}

# after POST /api/kiosk/unlock returned `job`
url = API_BASE.replace("/api", "") + job["fileUrl"]          # https://.../api/kiosk/jobs/JOB_xxx/file
r = requests.get(url, headers=signed_headers(MACHINE_ID, API_KEY), timeout=60)
r.raise_for_status()
open("/tmp/print_job.pdf", "wb").write(r.content)
```

The Pi can optionally receive payment notifications in real time:
`socket.emit("kiosk:join", {machineId, timestamp, apiKey, signature})`, where the signature is made the same way over `"{}"`. Then listen for `payment_success`, which contains only `{ jobId, machineId }`.

**Transition:** until every Pi has this update, set the Railway variable `LEGACY_PUBLIC_UPLOADS=true`. That keeps the old `/uploads/<file>` links working. Remove it as soon as the Pis are updated, because while it is on, files are public again.

## Deploy checklist

1. **Change the Razorpay keys and the JWT secret.** The old ones were in the shared zip, in `payment.env`, and in comments in the old `razorpay.js`.
2. **Railway.** The start command is now `node src/server.js` (set in `railway.json`). Set the variables listed in `.env.example`.
3. **Git.** Run `git rm -r --cached uploads .env payment.env` and commit. That removes them from git but keeps them on disk. To remove them from old commits as well, use `git filter-repo`.
4. **Database (only if needed).** If marking a job printed logs `CLEAR file_path ERROR`, run:
   ```sql
   ALTER TABLE print_jobs MODIFY file_path VARCHAR(512) NULL;
   ```

## Still open (unchanged on purpose, so nothing breaks)

- **Some admin routes need no login:** `/stats`, `/createmachine`, `/machines` (edit and delete), `/revenue` and others. Add `verifyAdminToken` once the admin frontend sends its token.
- **`/api/register-machine`** still needs no login and still returns the stored plain API key.
