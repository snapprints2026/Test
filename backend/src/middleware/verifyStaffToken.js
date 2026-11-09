// middleware/verifyStaffToken.js
// Staff logins (JWT, "Authorization: Bearer <token>"):
//   admin   — SnapPrints staff. Role (SUPER_ADMIN / ADMIN / FINANCE / SUPPORT)
//             and status are read from the database on every request, so a
//             role change or deactivation takes effect immediately.
//   vendor  — machine operators
//   officer — read-only department logins, scoped to their organisation tree
const jwt = require("jsonwebtoken");
const db = require("../database/db");
const { descendantIds } = require("../services/org.service");

const ADMIN_ROLES = ["SUPER_ADMIN", "ADMIN", "FINANCE", "SUPPORT"];

function readToken(req) {
  const authHeader = req.headers.authorization || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
}

function verifyStaffToken(requiredRole) {
  return async (req, res, next) => {
    let decoded;
    try {
      const token = readToken(req);
      if (!token) return res.status(401).json({ error: "No token provided" });
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
    if (requiredRole && decoded.role !== requiredRole) {
      return res.status(403).json({ error: "Forbidden — wrong role for this resource" });
    }
    req.staff = decoded; // { id, role, name, email }

    try {
      if (decoded.role === "admin") {
        const [[a]] = await db.query(`SELECT role, status FROM admin_users WHERE id=?`, [decoded.id]);
        if (!a || a.status !== "ACTIVE") return res.status(401).json({ error: "Account disabled" });
        req.staff.adminRole = a.role;
      } else if (decoded.role === "officer") {
        const [[o]] = await db.query(`SELECT organization_id, status FROM officers WHERE id=?`, [decoded.id]);
        if (!o || o.status !== "ACTIVE") return res.status(401).json({ error: "Account disabled" });
        req.staff.organizationId = o.organization_id;
        req.staff.orgIds = await descendantIds(o.organization_id);
      } else if (decoded.role === "vendor") {
        const [[v]] = await db.query(`SELECT status FROM vendors WHERE id=?`, [decoded.id]);
        if (!v || v.status !== "ACTIVE") return res.status(401).json({ error: "Account disabled" });
      }
    } catch (err) {
      console.error("STAFF AUTH ERROR:", err.message);
      return res.status(500).json({ error: "Auth failed" });
    }
    next();
  };
}

/* After verifyAdminToken: only these admin roles may continue. */
function requireAdminRole(...roles) {
  return (req, res, next) =>
    req.staff && roles.includes(req.staff.adminRole)
      ? next()
      : res.status(403).json({ error: `Your admin role (${req.staff?.adminRole || "none"}) can't do this` });
}

// Common groups
const CAN_MANAGE = requireAdminRole("SUPER_ADMIN", "ADMIN");                      // machines, vendors, orgs, contracts, forms
const CAN_FINANCE = requireAdminRole("SUPER_ADMIN", "ADMIN", "FINANCE");          // invoices, settlements, withdrawals, pricing approval
const CAN_SUPPORT = requireAdminRole("SUPER_ADMIN", "ADMIN", "SUPPORT");          // tickets, machine settings
const CAN_REFUND = requireAdminRole("SUPER_ADMIN", "ADMIN", "FINANCE", "SUPPORT");
const SUPER_ONLY = requireAdminRole("SUPER_ADMIN");

module.exports = {
  ADMIN_ROLES,
  verifyAdminToken: verifyStaffToken("admin"),
  verifyVendorToken: verifyStaffToken("vendor"),
  verifyOfficerToken: verifyStaffToken("officer"),
  requireAdminRole,
  CAN_MANAGE,
  CAN_FINANCE,
  CAN_SUPPORT,
  CAN_REFUND,
  SUPER_ONLY,
};
