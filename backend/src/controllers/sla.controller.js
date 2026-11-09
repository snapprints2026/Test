// src/controllers/sla.controller.js
// SLA reports and downtime events. Admin sees everything; officers see the
// machines of their organisations (scoped = true).
const db = require("../database/db");
const sla = require("../services/sla.service");
const { audit } = require("../services/audit.service");
const { monthStart } = require("../services/time.service");

const fail = (res, status, error) => res.status(status).json({ error });
const monthParam = (m) => (/^\d{4}-\d{2}(-\d{2})?$/.test(String(m || "")) ? `${String(m).slice(0, 7)}-01` : monthStart(0));

/* GET …/sla?month=2026-10&contractId&machineId */
exports.listReports = (scoped = false) => async (req, res) => {
  try {
    const month = monthParam(req.query.month);
    const where = ["s.month=?"];
    const params = [month];
    if (req.query.contractId) { where.push("s.contract_id=?"); params.push(Number(req.query.contractId)); }
    if (req.query.machineId) { where.push("s.machine_id=?"); params.push(req.query.machineId); }
    if (scoped) {
      where.push(req.staff.orgIds.length ? "m.organization_id IN (?)" : "FALSE");
      if (req.staff.orgIds.length) params.push(req.staff.orgIds);
    }
    const [rows] = await db.query(
      `SELECT s.*, DATE_FORMAT(s.month, '%Y-%m') AS month_label, m.name AS machine_name, o.name AS organization_name,
              c.contract_no
       FROM sla_reports s
       JOIN machines m ON m.machine_id = s.machine_id
       LEFT JOIN organizations o ON o.id = m.organization_id
       LEFT JOIN contracts c ON c.id = s.contract_id
       WHERE ${where.join(" AND ")}
       ORDER BY s.breached DESC, s.uptime_pct ASC, s.machine_id`,
      params
    );
    res.json({ month: month.slice(0, 7), reports: rows });
  } catch (err) {
    console.error("SLA LIST ERROR:", err);
    res.status(500).json({ error: "Failed to load SLA reports" });
  }
};

/* POST /api/admin/sla/generate  { month?, machineIds? } — recompute now */
exports.generate = async (req, res) => {
  try {
    const month = monthParam(req.body.month);
    const n = await sla.generateMonth(month, { machineIds: Array.isArray(req.body.machineIds) ? req.body.machineIds : null });
    await audit(req, "SLA_REPORTS_GENERATED", { details: { month, machines: n } });
    res.json({ success: true, month: month.slice(0, 7), machines: n });
  } catch (err) {
    console.error("SLA GENERATE ERROR:", err);
    res.status(500).json({ error: "Failed to generate SLA reports" });
  }
};

/* GET …/downtime?machineId&from&to&open=1 */
exports.listDowntime = (scoped = false) => async (req, res) => {
  try {
    const where = [];
    const params = [];
    if (req.query.machineId) { where.push("d.machine_id=?"); params.push(req.query.machineId); }
    if (req.query.open === "1") where.push("d.ended_at IS NULL");
    if (req.query.month) {
      const month = monthParam(req.query.month);
      where.push("d.started_at < DATE_ADD(?, INTERVAL 1 MONTH) AND (d.ended_at IS NULL OR d.ended_at >= ?)");
      params.push(month, month);
    }
    if (scoped) {
      where.push(req.staff.orgIds.length ? "m.organization_id IN (?)" : "FALSE");
      if (req.staff.orgIds.length) params.push(req.staff.orgIds);
    }
    const [rows] = await db.query(
      `SELECT d.*, m.name AS machine_name,
              TIMESTAMPDIFF(MINUTE, d.started_at, COALESCE(d.ended_at, NOW())) AS minutes
       FROM downtime_events d JOIN machines m ON m.machine_id = d.machine_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY d.started_at DESC LIMIT 500`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error("DOWNTIME LIST ERROR:", err);
    res.status(500).json({ error: "Failed to load downtime" });
  }
};

/* PATCH /api/admin/downtime/:eventId  { excluded?, notes? } */
exports.updateDowntime = async (req, res) => {
  try {
    const id = Number(req.params.eventId);
    const sets = [];
    const params = [];
    if (req.body.excluded !== undefined) { sets.push("excluded=?"); params.push(req.body.excluded ? 1 : 0); }
    if (req.body.notes !== undefined) { sets.push("notes=?"); params.push(req.body.notes ? String(req.body.notes).slice(0, 500) : null); }
    if (!sets.length) return res.json({ success: true });
    const [r] = await db.query(`UPDATE downtime_events SET ${sets.join(", ")} WHERE id=?`, [...params, id]);
    if (!r.affectedRows) return fail(res, 404, "Event not found");
    await audit(req, "DOWNTIME_UPDATED", { details: { id, ...req.body } });
    res.json({ success: true });
  } catch (err) {
    console.error("DOWNTIME UPDATE ERROR:", err);
    res.status(500).json({ error: "Failed to update event" });
  }
};

/* POST /api/admin/downtime  { machineId, startedAt, endedAt, notes } — planned maintenance (not counted) */
exports.addMaintenance = async (req, res) => {
  try {
    const { machineId, startedAt, endedAt, notes } = req.body;
    const s = new Date(startedAt);
    const e = new Date(endedAt);
    if (!machineId || Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e <= s)
      return fail(res, 400, "machineId, startedAt and endedAt (after start) are required");
    const [[m]] = await db.query(`SELECT machine_id FROM machines WHERE machine_id=?`, [machineId]);
    if (!m) return fail(res, 404, "Machine not found");
    const [r] = await db.query(
      `INSERT INTO downtime_events (machine_id, reason, started_at, ended_at, excluded, notes) VALUES (?, 'MAINTENANCE', ?, ?, 1, ?)`,
      [machineId, s, e, notes ? String(notes).slice(0, 500) : "Planned maintenance"]
    );
    await audit(req, "MAINTENANCE_SCHEDULED", { machineId, details: { id: r.insertId, startedAt, endedAt } });
    res.json({ success: true, id: r.insertId });
  } catch (err) {
    console.error("MAINTENANCE ERROR:", err);
    res.status(500).json({ error: "Failed to add maintenance window" });
  }
};
