// routes/auth.routes.js → /api/auth/...
//   POST /admin/login     SnapPrints staff
//   POST /vendor/login    machine operators
//   POST /officer/login   department officers (read-only)
//   POST /login, /resend-otp, /verify-otp   customer mobile OTP
//
// Customer OTPs are stored only as an HMAC hash, expire after 5 minutes and
// are invalidated after 5 wrong tries.
const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const router = express.Router();
const db = require("../database/db");
const { hashSecret, safeEqual } = require("../services/crypto.service");
const { logAudit } = require("../services/audit.service");
const { readConsent, recordConsent } = require("../services/consent.service");
const { rateLimit } = require("../middleware/rateLimit");

const generateOTP = () => crypto.randomInt(100000, 1000000).toString(); // 6-digit
const MOBILE_REGEX = /^[6-9]\d{9}$/;
const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

const staffLimit = rateLimit({ max: 10, windowMinutes: 15, message: "Too many login attempts. Try again in 15 minutes." });
const otpSendLimit = rateLimit({
  max: 5, windowMinutes: 15, keyFn: (req) => `m:${String(req.body?.mobile || "").trim()}`,
  message: "Too many codes requested for this number. Try again in 15 minutes.",
});
const otpIpLimit = rateLimit({ max: 30, windowMinutes: 15 });

/* ── Placeholder SMS sender — wire up your SMS gateway here ── */
async function sendOtpSms(mobile, otp) {
  // TODO: replace with a real DLT-registered gateway, e.g. MSG91 / Twilio:
  // await fetch("https://api.msg91.com/api/v5/otp", { ... });
  if (process.env.NODE_ENV !== "production") console.log(`[SMS MOCK] OTP ${otp} → +91${mobile}`);
  else console.log(`[SMS MOCK] OTP sent to +91${mobile.slice(0, 2)}******${mobile.slice(-2)}`);
}

function issueToken(customer, mobile) {
  return jwt.sign({ customerId: customer.id, mobile, role: "customer" }, process.env.JWT_SECRET, { expiresIn: "30d" });
}

const cleanEmail = (e) => String(e || "").trim().toLowerCase();

/* POST /api/auth/admin/login   { email, password } */
router.post("/admin/login", staffLimit, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password are required" });
    const [[admin]] = await db.query(`SELECT * FROM admin_users WHERE email=? AND status='ACTIVE'`, [cleanEmail(email)]);
    if (!admin || !(await bcrypt.compare(password, admin.password_hash)))
      return res.status(401).json({ error: "Invalid credentials" });

    await db.query(`UPDATE admin_users SET last_login_at=NOW() WHERE id=?`, [admin.id]);
    await logAudit(null, null, "ADMIN_LOGIN", null, { type: "ADMIN", id: admin.id, ip: req.ip });
    const token = jwt.sign(
      { id: admin.id, role: "admin", name: admin.name, email: admin.email },
      process.env.JWT_SECRET, { expiresIn: "7d" }
    );
    res.json({ token, user: { id: admin.id, name: admin.name, email: admin.email, role: "admin", adminRole: admin.role } });
  } catch (err) {
    console.error("ADMIN LOGIN ERROR:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

/* POST /api/auth/vendor/login   { email, password } */
router.post("/vendor/login", staffLimit, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password are required" });
    const [[vendor]] = await db.query(`SELECT * FROM vendors WHERE email=? AND status='ACTIVE'`, [cleanEmail(email)]);
    if (!vendor || !(await bcrypt.compare(password, vendor.password_hash)))
      return res.status(401).json({ error: "Invalid credentials" });

    await logAudit(null, null, "VENDOR_LOGIN", null, { type: "VENDOR", id: vendor.id, ip: req.ip });
    const token = jwt.sign(
      { id: vendor.id, role: "vendor", name: vendor.full_name, email: vendor.email },
      process.env.JWT_SECRET, { expiresIn: "7d" }
    );
    res.json({
      token,
      user: { id: vendor.id, name: vendor.full_name, email: vendor.email, businessName: vendor.business_name, segment: vendor.segment, role: "vendor" },
    });
  } catch (err) {
    console.error("VENDOR LOGIN ERROR:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

/* POST /api/auth/officer/login   { email, password } */
router.post("/officer/login", staffLimit, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password are required" });
    const [[officer]] = await db.query(
      `SELECT f.*, o.name AS org_name, o.office_code FROM officers f
       JOIN organizations o ON o.id = f.organization_id
       WHERE f.email=? AND f.status='ACTIVE'`,
      [cleanEmail(email)]
    );
    if (!officer || !(await bcrypt.compare(password, officer.password_hash)))
      return res.status(401).json({ error: "Invalid credentials" });

    await db.query(`UPDATE officers SET last_login_at=NOW() WHERE id=?`, [officer.id]);
    await logAudit(null, null, "OFFICER_LOGIN", null, { type: "OFFICER", id: officer.id, ip: req.ip });
    const token = jwt.sign(
      { id: officer.id, role: "officer", name: officer.name, email: officer.email },
      process.env.JWT_SECRET, { expiresIn: "7d" }
    );
    res.json({
      token,
      user: {
        id: officer.id, name: officer.name, email: officer.email, role: "officer",
        designation: officer.designation, organizationId: officer.organization_id,
        organizationName: officer.org_name, officeCode: officer.office_code,
      },
    });
  } catch (err) {
    console.error("OFFICER LOGIN ERROR:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

async function sendNewOtp(mobile, existing) {
  const otp = generateOTP();
  const expiry = new Date(Date.now() + OTP_TTL_MS);
  // customers.name may be NOT NULL on old databases — keep a placeholder
  const placeholderName = existing?.name || `Cust${mobile.slice(-4)}`;
  await db.query(
    `INSERT INTO customers (name, phone, otp_hash, otp_attempts, otp_verified, otp_expires_at)
     VALUES (?, ?, ?, 0, 0, ?)
     ON DUPLICATE KEY UPDATE otp_hash=VALUES(otp_hash), otp_attempts=0, otp_verified=0,
       otp_expires_at=VALUES(otp_expires_at), deleted_at=NULL`,
    [placeholderName, mobile, hashSecret(`${mobile}:${otp}`), expiry]
  );
  await sendOtpSms(mobile, otp);
}

/* POST /api/auth/login   { mobile } — always sends an OTP.
   Returning users on the same device skip this via their saved 30-day token. */
router.post("/login", otpIpLimit, otpSendLimit, async (req, res) => {
  try {
    const mobile = String(req.body?.mobile || "").trim();
    if (!MOBILE_REGEX.test(mobile)) return res.status(400).json({ error: "Enter a valid 10-digit mobile number" });
    const [[existing]] = await db.query(`SELECT id, name FROM customers WHERE phone=?`, [mobile]);
    await sendNewOtp(mobile, existing);
    return res.json({ status: "otp_sent" });
  } catch (err) {
    console.error("AUTH LOGIN ERROR:", err);
    return res.status(500).json({ error: "Login failed" });
  }
});

/* POST /api/auth/resend-otp   { mobile } */
router.post("/resend-otp", otpIpLimit, otpSendLimit, async (req, res) => {
  try {
    const mobile = String(req.body?.mobile || "").trim();
    if (!MOBILE_REGEX.test(mobile)) return res.status(400).json({ error: "Enter a valid 10-digit mobile number" });
    const [[existing]] = await db.query(`SELECT id, name FROM customers WHERE phone=?`, [mobile]);
    if (!existing) return res.status(404).json({ error: "No login attempt found for this number" });
    await sendNewOtp(mobile, existing);
    return res.json({ success: true });
  } catch (err) {
    console.error("AUTH RESEND ERROR:", err);
    return res.status(500).json({ error: "Could not resend OTP" });
  }
});

/* POST /api/auth/verify-otp   { mobile, otp, consent? } */
router.post("/verify-otp", otpIpLimit, async (req, res) => {
  try {
    const mobile = String(req.body?.mobile || "").trim();
    const otp = String(req.body?.otp || "").trim();
    if (!mobile || !otp) return res.status(400).json({ error: "Mobile and OTP are required" });

    const [[customer]] = await db.query(`SELECT * FROM customers WHERE phone=?`, [mobile]);
    if (!customer || !customer.otp_hash) return res.status(400).json({ error: "Please request a new OTP" });
    if (!customer.otp_expires_at || new Date(customer.otp_expires_at) < new Date())
      return res.status(400).json({ error: "OTP expired. Please request a new one." });
    if (customer.otp_attempts >= MAX_OTP_ATTEMPTS)
      return res.status(429).json({ error: "Too many wrong tries. Please request a new OTP." });

    if (!safeEqual(hashSecret(`${mobile}:${otp}`), customer.otp_hash)) {
      await db.query(`UPDATE customers SET otp_attempts=otp_attempts+1 WHERE id=?`, [customer.id]);
      return res.status(400).json({ error: "Invalid OTP" });
    }

    await db.query(
      `UPDATE customers SET otp_verified=1, otp_hash=NULL, otp_attempts=0, otp_expires_at=NULL WHERE id=?`, [customer.id]
    );
    const consent = readConsent(req.body);
    if (consent) await recordConsent({ customerId: customer.id, consent, ip: req.ip, purpose: "ACCOUNT_LOGIN" });

    return res.json({
      status: "logged_in",
      token: issueToken(customer, mobile),
      user: { name: customer.name, mobile },
    });
  } catch (err) {
    console.error("AUTH VERIFY ERROR:", err);
    return res.status(500).json({ error: "OTP verification failed" });
  }
});

module.exports = router;
