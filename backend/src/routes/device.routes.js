// src/routes/device.routes.js — device registration with a setup code (both modules) → /api/devices/...
const express = require("express");
const router = express.Router();
const device = require("../controllers/device.controller");

// Simple in-memory brake on guessing setup codes: 20 tries / 15 min per IP.
const attempts = new Map();
function limit(req, res, next) {
  const now = Date.now();
  const a = attempts.get(req.ip) || { n: 0, since: now };
  if (now - a.since > 15 * 60 * 1000) { a.n = 0; a.since = now; }
  a.n += 1;
  attempts.set(req.ip, a);
  if (a.n > 20) return res.status(429).json({ error: "Too many attempts. Try again in 15 minutes." });
  next();
}

router.post("/register", limit, device.register);

module.exports = router;
