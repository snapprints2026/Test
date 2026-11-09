# SnapPrints: landing page + admin / vendor dashboard

Vite + React + Tailwind.

- `/` is the landing page. `/login` leads to `/admin/*` or `/vendor/*` depending on the role.
- **Admin:**
  - vendors, with the modules they bought (Module 1 Kiosk / Module 2 Shop computer)
  - machines: module, customer-login setting, setup codes, shop printers
  - customers, refunds, withdrawals
- **Vendor:** their machines, revenue, bank details and withdrawals. For shop machines also printers (pause/resume) and recent orders with pickup codes.

```bash
cp .env.example .env           # VITE_API_BASE=http://localhost:5000/api
npm install
npm run dev                    # http://localhost:5173
```

Vercel: Root Directory `dashboard`, environment variable `VITE_API_BASE`. `vercel.json` sends every route to `index.html`.

The old Next.js landing-page files from the earlier portfolio repo were removed. The same landing page lives in `src/components/landing/`.
