// src/app.js — Express app: middleware, routes, error handling.
const express = require("express");
const cors = require("cors");
const env = require("./config/env");
const { corsOptions } = require("./config/cors");
const { notFound, errorHandler } = require("./middleware/errorHandler");
const payment = require("./controllers/payment.controller");

const app = express();
app.set("trust proxy", 1); // Railway sits behind a proxy → correct req.ip

app.use(cors(corsOptions));
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

// Razorpay webhook needs the exact raw body to check its signature → before express.json
app.post("/api/payments/razorpay-webhook", express.raw({ type: "*/*", limit: "1mb" }), payment.razorpayWebhook);

// Signed file links: decrypting download for devices / scans, raw scan upload (before express.json)
app.use("/api/files", require("./routes/files.routes"));

// Laptop testing: this server stands in for Cloudflare R2 (STORAGE_DRIVER=local)
if (env.STORAGE_DRIVER === "local") {
  app.use("/api/local-storage", require("./routes/localStorage.routes"));
}

app.use(express.json({ limit: "1mb" }));

/* ── Health check (Railway) ── */
app.get("/health", (req, res) => res.json({ status: "ok", ts: new Date().toISOString() }));

/* ── Routes ── */
app.use("/api/admin",        require("./routes/admin.routes"));
app.use("/api/auth",         require("./routes/auth.routes"));
app.use("/api/customer",     require("./routes/customer.routes"));
app.use("/api/vendor",       require("./routes/vendor.routes"));
app.use("/api/officer",      require("./routes/officer.routes"));   // read-only department logins
app.use("/api/support",      require("./routes/support.routes"));   // customer "report a problem"
app.use("/api/request-demo", require("./routes/demo.routes"));
app.use("/api/machines",     require("./routes/machine.routes"));
app.use("/api/devices",      require("./routes/device.routes"));   // setup-code registration (both modules)
app.use("/api/agent",        require("./routes/agent.routes"));    // Module 2 shop computers
app.use("/api",              require("./routes/kiosk.routes"));    // Module 1 Raspberry Pi kiosks
app.use("/api",              require("./routes/job.routes"));
app.use("/api",              require("./routes/payment.routes"));

/* ── 404 + errors (always JSON) ── */
app.use(notFound);
app.use(errorHandler);

module.exports = app;
