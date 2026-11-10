// src/middleware/requirePassword.js
// "Type your password to confirm" for risky admin actions (role changes,
// refunds, payouts, deleting things). Use AFTER verifyAdminToken and the role
// check, e.g.
//   router.patch("/admin-users/:adminId", SUPER_ONLY, requirePassword, admin.updateAdminUser);
//
// The dashboard sends the logged-in admin's own password in the
// "X-Confirm-Password" header. We check it against admin_users.password_hash.
//
// Answers:
//   403 { code: "PASSWORD_REQUIRED" }  no password sent
//   403 { code: "PASSWORD_WRONG" }     wrong password (403, not 401, so the
//                                      dashboard does not log the admin out)
//   429 { code: "PASSWORD_LOCKED" }    5 wrong tries → wait 15 minutes
const bcrypt = require("bcrypt");
const db = require("../database/db");
const { logAudit } = require("../services/audit.service");

const MAX_TRIES = 5;
const LOCK_MS = 15 * 60 * 1000;
const failures = new Map(); // adminId → { count, until }

function lockedFor(adminId) {
  const f = failures.get(adminId);
  if (!f) return 0;
  if (f.until && f.until > Date.now()) return Math.ceil((f.until - Date.now()) / 60000);
  if (f.until && f.until <= Date.now()) failures.delete(adminId);
  return 0;
}

async function requirePassword(req, res, next) {
  const adminId = req.staff && req.staff.id;
  if (!adminId || req.staff.role !== "admin") return res.status(403).json({ error: "Admins only" });

  const minutes = lockedFor(adminId);
  if (minutes) {
    return res.status(429).json({ code: "PASSWORD_LOCKED", error: `Too many wrong passwords. Try again in ${minutes} min.` });
  }

  const password = req.get("X-Confirm-Password") || "";
  if (!password) {
    return res.status(403).json({ code: "PASSWORD_REQUIRED", error: "Enter your password to confirm this change" });
  }

  try {
    const [[admin]] = await db.query(`SELECT password_hash FROM admin_users WHERE id=? AND status='ACTIVE'`, [adminId]);
    const ok = admin && (await bcrypt.compare(password, admin.password_hash));
    if (!ok) {
      const f = failures.get(adminId) || { count: 0, until: 0 };
      f.count += 1;
      if (f.count >= MAX_TRIES) f.until = Date.now() + LOCK_MS;
      failures.set(adminId, f);
      await logAudit(null, null, "CONFIRM_PASSWORD_FAILED", { path: req.originalUrl, tries: f.count },
        { type: "ADMIN", id: adminId, ip: req.ip });
      return res.status(403).json({ code: "PASSWORD_WRONG", error: "Wrong password" });
    }
    failures.delete(adminId);
    req.passwordConfirmed = true;
    next();
  } catch (err) {
    console.error("CONFIRM PASSWORD ERROR:", err.message);
    res.status(500).json({ error: "Could not check password" });
  }
}

module.exports = { requirePassword };
