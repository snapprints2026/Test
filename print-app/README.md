# SnapPrints: customer print page

The page the QR code opens: `https://<this-site>/?machine=MH1001`.

It asks the backend what kind of machine this is (`/api/machines/:id/status`) and adapts:

- **Kiosk (Module 1):** upload → pay → OTP to type at the kiosk
- **Shop computer (Module 2):** upload → only the options the shop's printers support → pay → pickup code with live progress (Paid → Printing → Ready)
- **Customer login:** shown only if the admin switched it on for that machine

```bash
cp .env.example .env.local     # REACT_APP_API_BASE=http://localhost:5000/api
npm install
npm start                      # http://localhost:3000/?machine=MH1001
```

When the backend runs with `PAYMENT_MODE=mock`, a "TEST MODE" box replaces Razorpay checkout.

Vercel: Root Directory `print-app`, environment variable `REACT_APP_API_BASE`.
