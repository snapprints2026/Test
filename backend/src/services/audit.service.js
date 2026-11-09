// src/services/audit.service.js
// Append-only audit trail. action_type is free text (e.g. FILE_DELETED,
// CONTRACT_CREATED, PRICING_RULE_APPROVED). Every row records WHO did it
// (actor_type + actor_id) and from where (ip). Never throws.
const db = require("../database/db");

const ACTOR_TYPES = new Set(["ADMIN", "VENDOR", "OFFICER", "DEVICE", "SYSTEM", "CUSTOMER"]);

/**
 * logAudit(machineId, jobId, action, details?, actor?)
 *   actor = { type: "ADMIN"|"VENDOR"|"OFFICER"|"DEVICE"|"SYSTEM"|"CUSTOMER", id?, ip? }
 */
async function logAudit(machineId, jobId, action, details = null, actor = null) {
  try {
    const type = actor && ACTOR_TYPES.has(actor.type) ? actor.type : "SYSTEM";
    const actorId = actor && actor.id ? Number(actor.id) || null : null;
    await db.query(
      `INSERT INTO audit_logs (machine_id, job_id, action_type, actor_type, actor_id, actor_admin_id, ip, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        machineId || null,
        jobId || null,
        String(action || "OTHER").slice(0, 50),
        type,
        actorId,
        type === "ADMIN" ? actorId : null,
        actor && actor.ip ? String(actor.ip).slice(0, 64) : null,
        details ? JSON.stringify(details) : null,
      ]
    );
  } catch (err) {
    console.error("AUDIT LOG ERROR:", err.message);
  }
}

/* Who is making this request? (staff token, device signature or customer token) */
function actorFromReq(req) {
  if (!req) return null;
  const ip = req.ip || null;
  if (req.staff) {
    const type = { admin: "ADMIN", vendor: "VENDOR", officer: "OFFICER" }[req.staff.role] || "SYSTEM";
    return { type, id: req.staff.id, ip };
  }
  if (req.machine) return { type: "DEVICE", id: req.machine.id, ip };
  if (req.customer) return { type: "CUSTOMER", id: req.customer.customerId, ip };
  return { type: "CUSTOMER", id: null, ip };
}

/* Shorthand inside controllers. */
function audit(req, action, { machineId = null, jobId = null, details = null } = {}) {
  return logAudit(machineId, jobId, action, details, actorFromReq(req));
}

const SYSTEM = { type: "SYSTEM" };

module.exports = { logAudit, actorFromReq, audit, SYSTEM };
