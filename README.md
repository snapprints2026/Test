# SnapPrints

One project with both modules:

| Module | Who it's for | How the customer prints |
|---|---|---|
| **Module 1: Kiosk** | Raspberry Pi kiosk with one printer | Scan QR → upload → pay → type the **OTP** on the kiosk |
| **Module 2: Shop computer** | Xerox shop whose PC is connected to its copiers | Scan QR → upload → choose B&W / colour → pay → **prints automatically**, customer shows a pickup code like **K47** |

When the admin creates a **vendor**, they tick which modules that vendor bought. When they create a **machine**, they pick its module. Everything else (upload, pricing, Razorpay, revenue, payouts, dashboards) is shared.

Each vendor also has a **customer segment**. It decides the default services and how strictly documents are handled:

| Segment | Typical place | Who pays | Services by default | Privacy |
|---|---|---|---|---|
| Education | College kiosk | Student | Print, Photo of card | Strict (no file names kept) |
| Retail | Xerox shop | Customer | Print, Photo of card, Photocopy, Scan | Standard |
| Government | RTO, tehsil, municipal office | Citizen, or the department (monthly invoice) | Print, Photo of card, Forms | Strict |
| PSU | Bank branch, PSU office | Customer, or the branch | Print, Photo of card, Forms | Strict |

Government and PSU add forms, department billing, officer / branch-manager logins, contracts, GST invoices and SLA reports — see **[GOVERNMENT.md](GOVERNMENT.md)**.

**Photo of card** (every segment): the customer photographs Aadhaar, PAN, a licence or voter ID with the phone camera. The page finds the card's corners, straightens it, checks it isn't blurry or dark, and lays front and back on one A4 page at real card size (85.6 × 54 mm), like a xerox. All of it happens on the phone; only the finished page is uploaded.

**Issues & refunds**: kiosk OTPs that are never used and printer errors are refunded automatically. A customer whose order printed but went wrong taps *Report a problem*; the case lands in Admin → Issues & refunds with the job's timeline. Every paid order has a reference like `SP-7KQ2MX` that support can search, together with the UPI reference and phone number.

```
snapprints/
├── backend/      Node + Express API, MySQL, Socket.io      → Railway
├── print-app/    Customer print page (QR opens this)       → Vercel
├── dashboard/    Landing page + admin, vendor, officer dashboards → Vercel
├── shop-agent/   Module 2: print agent for the shop's PC   → installed on each shop computer
└── kiosk/        Module 1: Raspberry Pi kiosk app (Electron) → copied to each Pi
```

---

## 1. Run everything on your laptop

You need **Node.js 18 or newer** (nodejs.org, LTS) and **MySQL 8** (Windows: MySQL Installer, "Server only"; Mac: `brew install mysql`).
No Razorpay account, Cloudflare R2 or printer is needed for local testing.

### 1.1 Install

```bash
cd snapprints
npm run install:all
```

### 1.2 Create the database

In MySQL Workbench or the `mysql` command line:

```sql
CREATE DATABASE snapprints CHARACTER SET utf8mb4;
```

### 1.3 Settings files

```bash
# Windows (PowerShell): use "copy" instead of "cp"
cp backend/.env.example     backend/.env
cp print-app/.env.example   print-app/.env.local
cp dashboard/.env.example   dashboard/.env
```

Open `backend/.env` and set `DB_USER`, `DB_PASSWORD` and a long random `JWT_SECRET`. The defaults are already right for testing on a laptop:

- `PAYMENT_MODE=mock`: the print page shows a "Simulate payment" box, and no real money moves.
- `STORAGE_DRIVER=local`: uploads are saved in `backend/local-storage/`, not R2.
- `REQUIRE_CUSTOMER_LOGIN=false`

### 1.4 Create tables and test data

```bash
npm run db:setup
```

This creates every table, then demo logins, a government office tree with two contracts, and four machines. It prints something like this:

```
 Dashboard   admin@snapprints.local   / admin123     (admin)
             vendor@snapprints.local  / vendor123    (vendor)
             govops@snapprints.local  / vendor123    (government operator)
             officer@snapprints.local / officer123   (officer — read-only)

 MH1000  Kiosk (Module 1), college     setup code: 9THD-9RBE
 MH1001  Shop  (Module 2), xerox shop  setup code: HJFY-FZAW
 MH1002  Kiosk, RTO Panvel             setup code: 2J7M-8YWR
 MH1003  Shop, RTO counter (staff code 1234, billed to dept)  setup code: 5JG5-6YNN
```

Keep the setup codes. Run `npm --prefix backend run seed:dev` any time you need new ones.

### 1.5 Start

```bash
npm run dev
```

| Opens on | What |
|---|---|
| http://localhost:5000/health | Backend |
| http://localhost:3000/?machine=MH1001 | Customer print page (shop) |
| http://localhost:3000/?machine=MH1000 | Customer print page (kiosk) |
| http://localhost:5173 | Landing page; **Login** opens the dashboards |

---

## 2. Test Module 2 (shop computer)

Open a **second terminal** and set up the agent with the MH1001 code:

```bash
npm run agent:setup
```

- Server address: `http://localhost:5000/api`
- Setup code: the MH1001 code
- "Use dry-run mode?" → **y**, then "Add two demo printers?" → **y**

  If your laptop has a real printer installed, answer **n** and pick it instead. Then it really prints.

```bash
npm run agent
```

Then:

1. Open the shop screen at http://localhost:7300. It shows both printers as **Ready**.
2. Open http://localhost:3000/?machine=MH1001, upload a PDF, Word file or photo, choose **B&W** or **Colour**, then **Upload**.
3. Click **Pay & Print**, then OK on the test-mode box.
4. The page shows a pickup code and goes **Paid → Printing → Ready**. The shop screen lists the order. In dry-run mode the "printed" PDF is saved in `shop-agent/dry-run-prints/`, with a `.txt` file next to it listing copies, colour, sides and paper.

More things to try:

- **Pause** both printers on the shop screen, then pay for an order. It waits in the queue. **Resume**, and it prints.
- Choose **Colour + Duplex**. It's disabled, because the demo colour copier is single-sided.
- Stop the agent with Ctrl+C. Within 2 minutes the print page says the shop computer is offline, and orders wait until it's back. Orders nobody prints within `SHOP_QUEUE_EXPIRY_MINUTES` (120) are refunded automatically.

## 3. Test Module 1 (kiosk) without a Raspberry Pi

(The real Pi app is in `kiosk/` — see `kiosk/README.md`.)

```bash
npm run kiosk:sim -- register <MH1000 setup code>
```

1. Open http://localhost:3000/?machine=MH1000, then upload, pay, and note the 4-digit OTP.
2. Run `npm run kiosk:sim -- unlock <OTP>`. The simulator downloads the file into `backend/kiosk-sim-prints/` and marks it printed, and the customer page finishes.

## 4. Test the dashboards

At http://localhost:5173/login:

- **Admin** (admin@snapprints.local / admin123):
  - **Vendors → + Create Vendor**: tick Module 1, Module 2 or both.
  - **Machines → + Create Machine**: pick the module, vendor and customer-login setting. You get a **setup code** for the device.
  - **Machine → View**: change the module or login setting, create a new setup code, and pause or resume shop printers.
- **Vendor** (vendor@snapprints.local / vendor123): **My Machines → Test Xerox Shop** shows printers (pause/resume), recent orders with pickup codes, and revenue.
- **Officer** tab (officer@snapprints.local / officer123): the department's read-only portal — usage reports with CSV, machines, uptime, invoices, contracts and complaints.
- **Admin → Government / Finance / System** menus: organisations, contracts, forms, SLA, pricing rules (need a second admin to approve), invoices, settlements, audit log and admin users.

## 5. Test from your phone (same Wi-Fi)

Find your laptop's IP address (Windows: `ipconfig`, e.g. `192.168.1.20`), then:

- `backend/.env`: `API_BASE_URL=http://192.168.1.20:5000/api`
- `print-app/.env.local`: `REACT_APP_API_BASE=http://192.168.1.20:5000/api`
- Restart `npm run dev`, and on the phone open `http://192.168.1.20:3000/?machine=MH1001`.

If the phone can't connect, allow Node.js through Windows Firewall on private networks.

## 6. Payments with real Razorpay (still test money)

Get **test keys** (`rzp_test_…`) from Razorpay Dashboard → Account & Settings → API Keys. In `backend/.env` set `PAYMENT_MODE=razorpay`, `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`, then restart. The print page now opens real Razorpay checkout, and test cards and UPI work. Payments are refunded automatically when a print fails.

---

## How Module 2 works

```
Phone ──upload──► storage (R2 / local)        Phone ──pay──► Razorpay
                                                   │
               Razorpay webhook / verify-payment ──┘
                         │
                    backend marks job PAID, gives pickup code "K47"
                         │  socket "job_ready" (+ check every 15 s as backup)
                         ▼
               Shop print agent (shop computer)
                 claim job  → server picks the printer: B&W job → B&W copier first,
                              colour job → colour copier; must be online, enabled,
                              and support duplex / paper size
                 download PDF → print silently → report "printed"
                 print error  → retry once (another printer if possible) → else refund
```

- **Every upload is turned into a PDF** on the server: Word via LibreOffice, and images and text directly. So a 12-page Word file is now priced as 12 pages (before, it was priced as 1), and devices only ever print PDFs.
- **No OTP and no login** on shop machines, unless you switch login on for that machine.
- **Pickup code:** the customer's screen and the shop screen both show the same code, so the shopkeeper hands the right prints to the right person.
- **Admin can't break a live shop:** the module can't be switched while the machine has unfinished paid orders.

## What changed from the old code

See [`backend/CHANGES.md`](backend/CHANGES.md). In short: every existing machine stays Module 1, and every existing API path still works, so your current Raspberry Pis need no update. To go live, see [`DEPLOY.md`](DEPLOY.md).
