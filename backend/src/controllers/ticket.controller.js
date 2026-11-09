// src/controllers/ticket.controller.js
// Support tickets for admin (all), vendors (their machines) and officers
// (their organisations). Same endpoints, different scope.
const db = require("../database/db");
const tickets = require("../services/ticket.service");
const { audit } = require("../services/audit.service");

const fail = (res, status, error) => res.status(status).json({ error });
const ROLE_TYPE = { admin: "ADMIN", vendor: "VENDOR", officer: "OFFICER" };

/* What this staff member may see → { machineIds?, orgIds? } (admin: no limit) */
async function scopeFor(req) {
  if (req.staff.role === "admin") return {};
  if (req.staff.role === "vendor") {
    const [rows] = await db.query(`SELECT machine_id FROM machines WHERE owner_vendor_id=?`, [req.staff.id]);
    return { machineIds: rows.map((r) => r.machine_id) };
  }
  const orgIds = req.staff.orgIds || [];
  const [rows] = orgIds.length
    ? await db.query(`SELECT machine_id FROM machines WHERE organization_id IN (?)`, [orgIds])
    : [[]];
  return { orgIds, machineIds: rows.map((r) => r.machine_id) };
}

async function canSee(req, ticket) {
  if (req.staff.role === "admin") return true;
  const s = await scopeFor(req);
  return (s.machineIds || []).includes(ticket.machine_id) || (s.orgIds || []).includes(ticket.organization_id);
}

/* GET …/tickets?status=ACTIVE|OPEN|… */
exports.list = async (req, res) => {
  try {
    const s = await scopeFor(req);
    res.json(await tickets.listTickets({ status: req.query.status, ...s }));
  } catch (err) {
    console.error("TICKET LIST ERROR:", err);
    res.status(500).json({ error: "Failed to load tickets" });
  }
};

/* GET …/tickets/:ticketId */
exports.get = async (req, res) => {
  try {
    const t = await tickets.getTicket(Number(req.params.ticketId));
    if (!t || !(await canSee(req, t))) return fail(res, 404, "Ticket not found");
    if (req.staff.role !== "admin") delete t.contact_phone; // citizens' numbers stay with SnapPrints support
    res.json(t);
  } catch (err) {
    console.error("TICKET GET ERROR:", err);
    res.status(500).json({ error: "Failed to load ticket" });
  }
};

/* POST …/tickets  { machineId?, organizationId?, category, priority, subject, description } */
exports.create = async (req, res) => {
  try {
    const b = req.body;
    const s = await scopeFor(req);
    if (b.machineId && s.machineIds && !s.machineIds.includes(b.machineId)) return fail(res, 403, "Not your machine");
    let organizationId = b.organizationId ? Number(b.organizationId) : null;
    if (organizationId && s.orgIds && !s.orgIds.includes(organizationId)) return fail(res, 403, "Not your organisation");
    if (req.staff.role === "officer" && !b.machineId && !organizationId) organizationId = req.staff.organizationId;
    const t = await tickets.createTicket({
      machineId: b.machineId || null,
      organizationId,
      raisedByType: ROLE_TYPE[req.staff.role],
      raisedById: req.staff.id,
      category: b.category,
      priority: b.priority,
      subject: b.subject,
      description: b.description,
      authorName: req.staff.name,
    });
    await audit(req, "TICKET_CREATED", { machineId: b.machineId || null, details: { id: t.id, ticketNo: t.ticket_no } });
    res.json({ success: true, ...t });
  } catch (err) {
    if (err.status) return fail(res, err.status, err.message);
    console.error("TICKET CREATE ERROR:", err);
    res.status(500).json({ error: "Failed to create ticket" });
  }
};

/* POST …/tickets/:ticketId/updates  { message?, status? }  (+ admin: priority, assignedTo, resolutionNotes)
   Officers can comment and close / reopen their own tickets; vendors and admins can change any status. */
exports.update = async (req, res) => {
  try {
    const id = Number(req.params.ticketId);
    const t = await tickets.getTicket(id);
    if (!t || !(await canSee(req, t))) return fail(res, 404, "Ticket not found");
    const b = req.body;
    if (req.staff.role === "officer" && b.status && !["CLOSED", "OPEN"].includes(b.status))
      return fail(res, 403, "Officers can close or reopen a ticket");
    const extra = req.staff.role === "admin"
      ? { priority: b.priority, assignedTo: b.assignedTo, resolutionNotes: b.resolutionNotes }
      : {};
    if (!b.message && !b.status && !Object.values(extra).some((v) => v !== undefined))
      return fail(res, 400, "Nothing to update");
    await tickets.addUpdate(id, {
      authorType: ROLE_TYPE[req.staff.role], authorId: req.staff.id, authorName: req.staff.name,
      message: b.message || null, status: b.status || null, ...extra,
    });
    await audit(req, "TICKET_UPDATED", { machineId: t.machine_id, details: { id, status: b.status || null } });
    res.json({ success: true });
  } catch (err) {
    if (err.status) return fail(res, err.status, err.message);
    console.error("TICKET UPDATE ERROR:", err);
    res.status(500).json({ error: "Failed to update ticket" });
  }
};
