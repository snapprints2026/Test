// src/services/ticket.service.js
// Support tickets (complaints) with response / resolution times.
//   complained_at      when it was raised
//   first_response_at  first reply or status change by SnapPrints / the operator
//   resolved_at        when it was marked RESOLVED (or CLOSED)
const db = require("../database/db");

const STATUSES = ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED", "CLOSED"];
const CATEGORIES = ["MACHINE_DOWN", "PAPER_TONER", "PRINT_QUALITY", "PAYMENT", "REFUND", "OTHER"];
const PRIORITIES = ["LOW", "NORMAL", "HIGH", "CRITICAL"];
const RESPONDERS = new Set(["ADMIN", "VENDOR"]); // their reply counts as the response

async function createTicket(t) {
  const category = CATEGORIES.includes(t.category) ? t.category : "OTHER";
  const priority = PRIORITIES.includes(t.priority) ? t.priority : category === "MACHINE_DOWN" ? "HIGH" : "NORMAL";
  const subject = String(t.subject || "").trim().slice(0, 200);
  if (!subject) {
    const e = new Error("Subject is required");
    e.status = 400;
    throw e;
  }
  let organizationId = t.organizationId || null;
  if (t.machineId && !organizationId) {
    const [[m]] = await db.query(`SELECT organization_id FROM machines WHERE machine_id=?`, [t.machineId]);
    organizationId = m ? m.organization_id : null;
  }
  const [r] = await db.query(
    `INSERT INTO support_tickets
       (machine_id, organization_id, job_id, raised_by_type, raised_by_id, contact_phone, category, priority, subject, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [t.machineId || null, organizationId, t.jobId || null, t.raisedByType, t.raisedById || null,
     t.contactPhone ? String(t.contactPhone).slice(0, 20) : null, category, priority, subject,
     t.description ? String(t.description).slice(0, 5000) : null]
  );
  const now = new Date();
  const ticketNo = `T${String(now.getUTCFullYear()).slice(2)}${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(r.insertId).padStart(5, "0")}`;
  await db.query(`UPDATE support_tickets SET ticket_no=? WHERE id=?`, [ticketNo, r.insertId]);
  await db.query(
    `INSERT INTO support_ticket_updates (ticket_id, author_type, author_id, author_name, message, status_to)
     VALUES (?, ?, ?, ?, ?, 'OPEN')`,
    [r.insertId, t.raisedByType, t.raisedById || null, t.authorName || null, t.description || subject]
  );
  return { id: r.insertId, ticket_no: ticketNo };
}

/* A reply and/or status change. */
async function addUpdate(ticketId, { authorType, authorId = null, authorName = null, message = null, status = null, priority = null, assignedTo, resolutionNotes }) {
  const [[t]] = await db.query(`SELECT * FROM support_tickets WHERE id=?`, [ticketId]);
  if (!t) {
    const e = new Error("Ticket not found");
    e.status = 404;
    throw e;
  }
  if (status && !STATUSES.includes(status)) {
    const e = new Error("Invalid status");
    e.status = 400;
    throw e;
  }
  const sets = [];
  const params = [];
  const changed = status && status !== t.status;
  if (changed) {
    sets.push("status=?"); params.push(status);
    if (status === "RESOLVED" || status === "CLOSED") { sets.push("resolved_at=COALESCE(resolved_at, NOW())"); }
    if (status === "CLOSED") sets.push("closed_at=NOW()");
    if (status === "OPEN") { sets.push("resolved_at=NULL", "closed_at=NULL"); } // reopened
  }
  if (RESPONDERS.has(authorType) && !t.first_response_at && (changed || message)) sets.push("first_response_at=NOW()");
  if (priority && PRIORITIES.includes(priority) && priority !== t.priority) { sets.push("priority=?"); params.push(priority); }
  if (assignedTo !== undefined) { sets.push("assigned_to=?"); params.push(assignedTo || null); }
  if (resolutionNotes !== undefined) { sets.push("resolution_notes=?"); params.push(resolutionNotes ? String(resolutionNotes).slice(0, 1000) : null); }
  if (sets.length) await db.query(`UPDATE support_tickets SET ${sets.join(", ")} WHERE id=?`, [...params, ticketId]);
  if (message || changed) {
    await db.query(
      `INSERT INTO support_ticket_updates (ticket_id, author_type, author_id, author_name, message, status_from, status_to)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [ticketId, authorType, authorId, authorName, message ? String(message).slice(0, 5000) : null,
       changed ? t.status : null, changed ? status : null]
    );
  }
}

async function getTicket(ticketId) {
  const [[t]] = await db.query(
    `SELECT t.*, m.name AS machine_name, o.name AS org_name, a.name AS assigned_name,
            TIMESTAMPDIFF(MINUTE, t.complained_at, t.first_response_at) AS response_minutes,
            TIMESTAMPDIFF(MINUTE, t.complained_at, t.resolved_at) AS resolution_minutes
     FROM support_tickets t
     LEFT JOIN machines m ON m.machine_id = t.machine_id
     LEFT JOIN organizations o ON o.id = t.organization_id
     LEFT JOIN admin_users a ON a.id = t.assigned_to
     WHERE t.id=?`,
    [ticketId]
  );
  if (!t) return null;
  const [updates] = await db.query(
    `SELECT id, author_type, author_name, message, status_from, status_to, created_at
     FROM support_ticket_updates WHERE ticket_id=? ORDER BY created_at, id`,
    [ticketId]
  );
  return { ...t, updates };
}

/* filter: { status, machineIds, orgIds, onlyMachinesOrOrgs, limit } */
async function listTickets({ status, machineIds, orgIds, limit = 200 } = {}) {
  const where = [];
  const params = [];
  if (status === "ACTIVE") where.push("t.status NOT IN ('RESOLVED','CLOSED')");
  else if (status && STATUSES.includes(status)) { where.push("t.status=?"); params.push(status); }
  const scope = [];
  if (machineIds) { scope.push(machineIds.length ? "t.machine_id IN (?)" : "FALSE"); if (machineIds.length) params.push(machineIds); }
  if (orgIds) { scope.push(orgIds.length ? "t.organization_id IN (?)" : "FALSE"); if (orgIds.length) params.push(orgIds); }
  if (scope.length) where.push(`(${scope.join(" OR ")})`);
  const [rows] = await db.query(
    `SELECT t.id, t.ticket_no, t.machine_id, m.name AS machine_name, t.organization_id, o.name AS org_name,
            t.raised_by_type, t.category, t.priority, t.subject, t.status, t.complained_at, t.first_response_at,
            t.resolved_at, TIMESTAMPDIFF(MINUTE, t.complained_at, t.first_response_at) AS response_minutes,
            TIMESTAMPDIFF(MINUTE, t.complained_at, t.resolved_at) AS resolution_minutes
     FROM support_tickets t
     LEFT JOIN machines m ON m.machine_id = t.machine_id
     LEFT JOIN organizations o ON o.id = t.organization_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY FIELD(t.status,'OPEN','ACKNOWLEDGED','IN_PROGRESS','RESOLVED','CLOSED'), t.complained_at DESC
     LIMIT ${Math.min(Number(limit) || 200, 500)}`,
    params
  );
  return rows;
}

module.exports = { STATUSES, CATEGORIES, PRIORITIES, createTicket, addUpdate, getTicket, listTickets };
