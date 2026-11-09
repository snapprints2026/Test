// src/controllers/gov.controller.js
// Admin: organisations (the institution tree), officer logins and contracts.
const bcrypt = require("bcrypt");
const db = require("../database/db");
const orgs = require("../services/org.service");
const { audit } = require("../services/audit.service");
const { isYmd } = require("../services/time.service");

const str = (v, max) => (v === undefined || v === null || v === "" ? null : String(v).trim().slice(0, max));
const num = (v) => (v === undefined || v === null || v === "" ? null : Number(v));
const date = (v) => (isYmd(v) ? v : null);
const fail = (res, status, error) => res.status(status).json({ error });

/* ═════════════ ORGANISATIONS ═════════════ */

/* GET /api/admin/organizations → tree-ordered flat list (depth, path) */
exports.listOrganizations = async (req, res) => {
  try {
    res.json(await orgs.listTree());
  } catch (err) {
    console.error("ORG LIST ERROR:", err);
    res.status(500).json({ error: "Failed to load organisations" });
  }
};

function orgFields(b) {
  const out = {};
  const map = {
    name: ["name", 200], officeCode: ["office_code", 40], gstin: ["gstin", 20], address: ["address", 500],
    city: ["city", 100], state: ["state", 100], pincode: ["pincode", 10], contactName: ["contact_name", 150],
    contactEmail: ["contact_email", 190], contactPhone: ["contact_phone", 20],
  };
  for (const [k, [col, max]] of Object.entries(map)) if (b[k] !== undefined) out[col] = str(b[k], max);
  if (b.orgType !== undefined) out.org_type = orgs.ORG_TYPES.includes(b.orgType) ? b.orgType : "OFFICE";
  if (b.segment !== undefined) out.segment = orgs.SEGMENTS.includes(b.segment) ? b.segment : "GOVERNMENT";
  if (b.defaultLanguage !== undefined) out.default_language = ["en", "hi", "mr"].includes(b.defaultLanguage) ? b.defaultLanguage : null;
  if (b.status !== undefined) out.status = b.status === "INACTIVE" ? "INACTIVE" : "ACTIVE";
  if (b.vendorId !== undefined) out.vendor_id = num(b.vendorId) || null;
  if (b.parentId !== undefined) out.parent_id = num(b.parentId) || null;
  return out;
}

/* POST /api/admin/organizations */
exports.createOrganization = async (req, res) => {
  try {
    const f = orgFields(req.body);
    if (!f.name) return fail(res, 400, "Name is required");
    if (f.parent_id) {
      const [[p]] = await db.query(`SELECT id, segment FROM organizations WHERE id=?`, [f.parent_id]);
      if (!p) return fail(res, 404, "Parent organisation not found");
      if (!f.segment) f.segment = p.segment; // children inherit the segment
    }
    const cols = Object.keys(f);
    const [r] = await db.query(
      `INSERT INTO organizations (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, cols.map((c) => f[c])
    );
    await audit(req, "ORGANIZATION_CREATED", { details: { id: r.insertId, name: f.name, parentId: f.parent_id || null } });
    res.json({ success: true, id: r.insertId });
  } catch (err) {
    console.error("ORG CREATE ERROR:", err);
    res.status(500).json({ error: "Failed to create organisation" });
  }
};

/* PATCH /api/admin/organizations/:orgId */
exports.updateOrganization = async (req, res) => {
  try {
    const id = Number(req.params.orgId);
    const [[o]] = await db.query(`SELECT id FROM organizations WHERE id=?`, [id]);
    if (!o) return fail(res, 404, "Organisation not found");
    const f = orgFields(req.body);
    if (f.name === null) return fail(res, 400, "Name is required");
    if (f.parent_id !== undefined && (await orgs.wouldCreateCycle(id, f.parent_id)))
      return fail(res, 400, "An organisation can't be placed under itself or one of its own offices");
    const cols = Object.keys(f);
    if (!cols.length) return res.json({ success: true });
    await db.query(`UPDATE organizations SET ${cols.map((c) => `${c}=?`).join(", ")} WHERE id=?`, [...cols.map((c) => f[c]), id]);
    await audit(req, "ORGANIZATION_UPDATED", { details: { id, fields: cols } });
    res.json({ success: true });
  } catch (err) {
    console.error("ORG UPDATE ERROR:", err);
    res.status(500).json({ error: "Failed to update organisation" });
  }
};

/* GET /api/admin/organizations/:orgId → { organization, path, children, machines, contracts, officers, usage } */
exports.getOrganization = async (req, res) => {
  try {
    const id = Number(req.params.orgId);
    const [[organization]] = await db.query(
      `SELECT o.*, v.full_name AS vendor_name, p.name AS parent_name
       FROM organizations o LEFT JOIN vendors v ON v.id=o.vendor_id LEFT JOIN organizations p ON p.id=o.parent_id
       WHERE o.id=?`,
      [id]
    );
    if (!organization) return fail(res, 404, "Organisation not found");
    const ids = await orgs.descendantIds(id);
    const [children] = await db.query(
      `SELECT id, name, org_type, office_code, status FROM organizations WHERE parent_id=? ORDER BY name`, [id]
    );
    const [machinesRows] = await db.query(
      `SELECT m.machine_id, m.name, m.module, m.status, m.last_seen_at, m.billing_mode, m.enabled_job_types,
              m.organization_id, o.name AS organization_name, c.contract_no
       FROM machines m LEFT JOIN organizations o ON o.id=m.organization_id LEFT JOIN contracts c ON c.id=m.contract_id
       WHERE m.organization_id IN (?) ORDER BY o.name, m.machine_id`,
      [ids]
    );
    const [contracts] = await db.query(
      `SELECT c.id, c.contract_no, c.contract_type, c.title, c.start_date, c.end_date, c.status, o.name AS organization_name
       FROM contracts c JOIN organizations o ON o.id=c.organization_id WHERE c.organization_id IN (?) ORDER BY c.start_date DESC`,
      [ids]
    );
    const [officers] = await db.query(
      `SELECT f.id, f.name, f.email, f.phone, f.designation, f.status, f.last_login_at, f.organization_id,
              o.name AS organization_name
       FROM officers f JOIN organizations o ON o.id=f.organization_id WHERE f.organization_id IN (?) ORDER BY f.name`,
      [ids]
    );
    const [[usage]] = await db.query(
      `SELECT COUNT(*) AS orders, COALESCE(SUM(total_pages*copies),0) AS pages,
              COALESCE(SUM(CASE WHEN billing='CUSTOMER' THEN amount ELSE 0 END),0) AS customer_revenue,
              COALESCE(SUM(CASE WHEN billing='DEPARTMENT' THEN amount ELSE 0 END),0) AS department_billed
       FROM print_jobs WHERE organization_id IN (?) AND status='PRINTED' AND printed_at >= NOW() - INTERVAL 30 DAY`,
      [ids]
    );
    res.json({
      organization,
      path: await orgs.orgPath(id),
      children,
      machines: machinesRows.map((m) => ({ ...m, is_online: !!m.last_seen_at && Date.now() - new Date(m.last_seen_at) < 120000 })),
      contracts,
      officers,
      usage30d: usage,
    });
  } catch (err) {
    console.error("ORG DETAIL ERROR:", err);
    res.status(500).json({ error: "Failed to load organisation" });
  }
};

/* DELETE /api/admin/organizations/:orgId — only when nothing hangs off it */
exports.deleteOrganization = async (req, res) => {
  try {
    const id = Number(req.params.orgId);
    const [[c]] = await db.query(
      `SELECT (SELECT COUNT(*) FROM organizations WHERE parent_id=?) AS children,
              (SELECT COUNT(*) FROM machines WHERE organization_id=?) AS machines,
              (SELECT COUNT(*) FROM contracts WHERE organization_id=?) AS contracts,
              (SELECT COUNT(*) FROM print_jobs WHERE organization_id=?) AS jobs`,
      [id, id, id, id]
    );
    if (c.children || c.machines || c.contracts || c.jobs)
      return fail(res, 409, "This organisation still has offices, machines, contracts or orders. Set it INACTIVE instead.");
    const [r] = await db.query(`DELETE FROM organizations WHERE id=?`, [id]);
    if (!r.affectedRows) return fail(res, 404, "Organisation not found");
    await audit(req, "ORGANIZATION_DELETED", { details: { id } });
    res.json({ success: true });
  } catch (err) {
    console.error("ORG DELETE ERROR:", err);
    res.status(500).json({ error: "Failed to delete organisation" });
  }
};

/* ═════════════ OFFICERS ═════════════ */

/* POST /api/admin/officers  { organizationId, name, email, password, phone?, designation? } */
exports.createOfficer = async (req, res) => {
  try {
    const { organizationId, name, email, password, phone, designation } = req.body;
    if (!organizationId || !name || !email || !password) return fail(res, 400, "organizationId, name, email and password are required");
    if (String(password).length < 8) return fail(res, 400, "Password must be at least 8 characters");
    const [[o]] = await db.query(`SELECT id FROM organizations WHERE id=?`, [organizationId]);
    if (!o) return fail(res, 404, "Organisation not found");
    const clean = String(email).trim().toLowerCase();
    const [[dup]] = await db.query(`SELECT id FROM officers WHERE email=?`, [clean]);
    if (dup) return fail(res, 409, "An officer with this email already exists");
    const [r] = await db.query(
      `INSERT INTO officers (organization_id, name, email, phone, designation, password_hash, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [organizationId, str(name, 150), clean, str(phone, 20), str(designation, 120), await bcrypt.hash(String(password), 10), req.staff.id]
    );
    await audit(req, "OFFICER_CREATED", { details: { id: r.insertId, organizationId: Number(organizationId) } });
    res.json({ success: true, id: r.insertId });
  } catch (err) {
    console.error("OFFICER CREATE ERROR:", err);
    res.status(500).json({ error: "Failed to create officer" });
  }
};

/* PATCH /api/admin/officers/:officerId  { status?, password?, organizationId?, name?, phone?, designation? } */
exports.updateOfficer = async (req, res) => {
  try {
    const id = Number(req.params.officerId);
    const sets = [];
    const params = [];
    const b = req.body;
    if (b.status !== undefined) { sets.push("status=?"); params.push(b.status === "INACTIVE" ? "INACTIVE" : "ACTIVE"); }
    if (b.organizationId !== undefined) {
      const [[o]] = await db.query(`SELECT id FROM organizations WHERE id=?`, [b.organizationId]);
      if (!o) return fail(res, 404, "Organisation not found");
      sets.push("organization_id=?"); params.push(b.organizationId);
    }
    for (const [k, col, max] of [["name", "name", 150], ["phone", "phone", 20], ["designation", "designation", 120]]) {
      if (b[k] !== undefined) { sets.push(`${col}=?`); params.push(str(b[k], max)); }
    }
    if (b.password) {
      if (String(b.password).length < 8) return fail(res, 400, "Password must be at least 8 characters");
      sets.push("password_hash=?"); params.push(await bcrypt.hash(String(b.password), 10));
    }
    if (!sets.length) return res.json({ success: true });
    const [r] = await db.query(`UPDATE officers SET ${sets.join(", ")} WHERE id=?`, [...params, id]);
    if (!r.affectedRows) return fail(res, 404, "Officer not found");
    await audit(req, "OFFICER_UPDATED", { details: { id, fields: Object.keys(b).filter((k) => k !== "password"), password: !!b.password } });
    res.json({ success: true });
  } catch (err) {
    console.error("OFFICER UPDATE ERROR:", err);
    res.status(500).json({ error: "Failed to update officer" });
  }
};

/* ═════════════ CONTRACTS ═════════════ */
const CONTRACT_TYPES = ["SALE", "REVENUE_SHARE", "PAY_PER_USE", "RENTAL"];
const CONTRACT_STATUSES = ["DRAFT", "ACTIVE", "EXPIRED", "TERMINATED"];

function contractFields(b) {
  const f = {};
  if (b.contractNo !== undefined) f.contract_no = str(b.contractNo, 40);
  if (b.organizationId !== undefined) f.organization_id = num(b.organizationId);
  if (b.vendorId !== undefined) f.vendor_id = num(b.vendorId) || null;
  if (b.contractType !== undefined) f.contract_type = CONTRACT_TYPES.includes(b.contractType) ? b.contractType : null;
  for (const [k, col, max] of [["title", "title", 200], ["gemContractNo", "gem_contract_no", 80], ["poNumber", "po_number", 80], ["notes", "notes", 1000]])
    if (b[k] !== undefined) f[col] = str(b[k], max);
  for (const [k, col] of [["startDate", "start_date"], ["endDate", "end_date"], ["warrantyUntil", "warranty_until"], ["amcUntil", "amc_until"]])
    if (b[k] !== undefined) f[col] = date(b[k]);
  for (const [k, col] of [["amcAmount", "amc_amount"], ["rentalAmountMonthly", "rental_amount_monthly"], ["revenueSharePct", "revenue_share_pct"], ["slaUptimePct", "sla_uptime_pct"]])
    if (b[k] !== undefined) f[col] = num(b[k]);
  if (b.billingCycle !== undefined) f.billing_cycle = b.billingCycle === "QUARTERLY" ? "QUARTERLY" : "MONTHLY";
  if (b.status !== undefined) f.status = CONTRACT_STATUSES.includes(b.status) ? b.status : "ACTIVE";
  if (b.penaltyRules !== undefined) {
    let rules = b.penaltyRules;
    if (typeof rules === "string" && rules.trim()) {
      try { rules = JSON.parse(rules); } catch { return { error: "penaltyRules must be valid JSON" }; }
    }
    f.penalty_rules = rules && typeof rules === "object" ? JSON.stringify(rules) : null;
  }
  if (f.revenue_share_pct !== undefined && f.revenue_share_pct !== null && (f.revenue_share_pct < 0 || f.revenue_share_pct > 100))
    return { error: "revenueSharePct must be between 0 and 100" };
  if (f.sla_uptime_pct !== undefined && (f.sla_uptime_pct === null || f.sla_uptime_pct < 0 || f.sla_uptime_pct > 100))
    return { error: "slaUptimePct must be between 0 and 100" };
  return f;
}

async function nextContractNo() {
  const y = new Date().getUTCFullYear();
  const [[r]] = await db.query(`SELECT COUNT(*) n FROM contracts WHERE contract_no LIKE ?`, [`SPC-${y}-%`]);
  return `SPC-${y}-${String(Number(r.n) + 1).padStart(4, "0")}`;
}

/* GET /api/admin/contracts */
exports.listContracts = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT c.*, o.name AS organization_name, o.office_code, v.full_name AS vendor_name,
              (SELECT COUNT(*) FROM machines m WHERE m.contract_id=c.id) AS machine_count
       FROM contracts c JOIN organizations o ON o.id=c.organization_id LEFT JOIN vendors v ON v.id=c.vendor_id
       ORDER BY c.status='ACTIVE' DESC, c.start_date DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error("CONTRACT LIST ERROR:", err);
    res.status(500).json({ error: "Failed to load contracts" });
  }
};

/* POST /api/admin/contracts */
exports.createContract = async (req, res) => {
  try {
    const f = contractFields(req.body);
    if (f.error) return fail(res, 400, f.error);
    if (!f.organization_id) return fail(res, 400, "organizationId is required");
    if (!f.contract_type) return fail(res, 400, `contractType must be one of ${CONTRACT_TYPES.join(", ")}`);
    if (!f.start_date) return fail(res, 400, "startDate is required (YYYY-MM-DD)");
    if (f.contract_type === "REVENUE_SHARE" && !(f.revenue_share_pct > 0)) return fail(res, 400, "Revenue share % is required");
    if (f.contract_type === "RENTAL" && !(f.rental_amount_monthly > 0)) return fail(res, 400, "Monthly rental is required");
    const [[o]] = await db.query(`SELECT id FROM organizations WHERE id=?`, [f.organization_id]);
    if (!o) return fail(res, 404, "Organisation not found");
    if (!f.contract_no) f.contract_no = await nextContractNo();
    const [[dup]] = await db.query(`SELECT id FROM contracts WHERE contract_no=?`, [f.contract_no]);
    if (dup) return fail(res, 409, "A contract with this number already exists");
    f.created_by = req.staff.id;
    if (f.sla_uptime_pct === undefined) delete f.sla_uptime_pct;
    const cols = Object.keys(f);
    const [r] = await db.query(`INSERT INTO contracts (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, cols.map((c) => f[c]));
    await audit(req, "CONTRACT_CREATED", { details: { id: r.insertId, contractNo: f.contract_no, type: f.contract_type } });
    res.json({ success: true, id: r.insertId, contractNo: f.contract_no });
  } catch (err) {
    console.error("CONTRACT CREATE ERROR:", err);
    res.status(500).json({ error: "Failed to create contract" });
  }
};

/* PATCH /api/admin/contracts/:contractId */
exports.updateContract = async (req, res) => {
  try {
    const id = Number(req.params.contractId);
    const f = contractFields(req.body);
    if (f.error) return fail(res, 400, f.error);
    const [[c]] = await db.query(`SELECT * FROM contracts WHERE id=?`, [id]);
    if (!c) return fail(res, 404, "Contract not found");
    if (f.contract_type && f.contract_type !== c.contract_type && c.status !== "DRAFT")
      return fail(res, 400, "The contract type can only be changed while the contract is a DRAFT");
    if (f.contract_type === null) delete f.contract_type;
    const cols = Object.keys(f).filter((k) => f[k] !== undefined);
    if (!cols.length) return res.json({ success: true });
    await db.query(`UPDATE contracts SET ${cols.map((k) => `${k}=?`).join(", ")} WHERE id=?`, [...cols.map((k) => f[k]), id]);
    await audit(req, "CONTRACT_UPDATED", { details: { id, fields: cols } });
    res.json({ success: true });
  } catch (err) {
    console.error("CONTRACT UPDATE ERROR:", err);
    res.status(500).json({ error: "Failed to update contract" });
  }
};

/* GET /api/admin/contracts/:contractId → { contract, machines, invoices, settlements, sla } */
exports.getContract = async (req, res) => {
  try {
    const id = Number(req.params.contractId);
    const [[contract]] = await db.query(
      `SELECT c.*, o.name AS organization_name, o.office_code, v.full_name AS vendor_name
       FROM contracts c JOIN organizations o ON o.id=c.organization_id LEFT JOIN vendors v ON v.id=c.vendor_id
       WHERE c.id=?`,
      [id]
    );
    if (!contract) return fail(res, 404, "Contract not found");
    if (typeof contract.penalty_rules === "string") {
      try { contract.penalty_rules = JSON.parse(contract.penalty_rules); } catch { /* keep */ }
    }
    const [machinesRows] = await db.query(
      `SELECT m.machine_id, m.name, m.module, m.status, m.last_seen_at, m.billing_mode, o.name AS organization_name
       FROM machines m LEFT JOIN organizations o ON o.id=m.organization_id WHERE m.contract_id=? ORDER BY m.machine_id`,
      [id]
    );
    const [invoiceRows] = await db.query(
      `SELECT id, invoice_no, invoice_type, period_start, period_end, total, status, issued_at FROM invoices
       WHERE contract_id=? AND invoice_type <> 'CUSTOMER_RECEIPT' ORDER BY issued_at DESC LIMIT 50`,
      [id]
    );
    const [settlementRows] = await db.query(
      `SELECT * FROM settlements WHERE contract_id=? ORDER BY period_start DESC LIMIT 50`, [id]
    );
    const [sla] = await db.query(
      `SELECT machine_id, DATE_FORMAT(month,'%Y-%m') AS month, uptime_pct, breached, penalty_amount, is_final
       FROM sla_reports WHERE contract_id=? ORDER BY month DESC, machine_id LIMIT 120`,
      [id]
    );
    const [[usage]] = await db.query(
      `SELECT COUNT(*) AS orders, COALESCE(SUM(CASE WHEN billing='CUSTOMER' THEN amount ELSE 0 END),0) AS customer_revenue,
              COALESCE(SUM(CASE WHEN billing='DEPARTMENT' THEN amount ELSE 0 END),0) AS department_billed
       FROM print_jobs WHERE contract_id=? AND status='PRINTED'`,
      [id]
    );
    res.json({
      contract,
      machines: machinesRows.map((m) => ({ ...m, is_online: !!m.last_seen_at && Date.now() - new Date(m.last_seen_at) < 120000 })),
      invoices: invoiceRows,
      settlements: settlementRows,
      sla,
      usage,
    });
  } catch (err) {
    console.error("CONTRACT DETAIL ERROR:", err);
    res.status(500).json({ error: "Failed to load contract" });
  }
};

/* POST /api/admin/contracts/:contractId/machines  { machineIds: [...] } — link machines (and set their organisation) */
exports.attachMachines = async (req, res) => {
  try {
    const id = Number(req.params.contractId);
    const ids = Array.isArray(req.body.machineIds) ? req.body.machineIds.map(String) : [];
    if (!ids.length) return fail(res, 400, "machineIds is required");
    const [[c]] = await db.query(`SELECT id, organization_id, contract_type FROM contracts WHERE id=?`, [id]);
    if (!c) return fail(res, 404, "Contract not found");
    const sets = ["contract_id=?"];
    const params = [id];
    if (req.body.setOrganization !== false) { sets.push("organization_id=COALESCE(organization_id, ?)"); params.push(c.organization_id); }
    if (c.contract_type === "PAY_PER_USE" && req.body.departmentBilling !== false) sets.push("billing_mode='DEPARTMENT'");
    const [r] = await db.query(`UPDATE machines SET ${sets.join(", ")} WHERE machine_id IN (?)`, [...params, ids]);
    await audit(req, "CONTRACT_MACHINES_ATTACHED", { details: { contractId: id, machineIds: ids } });
    res.json({ success: true, updated: r.affectedRows });
  } catch (err) {
    console.error("CONTRACT ATTACH ERROR:", err);
    res.status(500).json({ error: "Failed to link machines" });
  }
};

/* DELETE /api/admin/contracts/:contractId/machines/:machineId */
exports.detachMachine = async (req, res) => {
  try {
    const [r] = await db.query(
      `UPDATE machines SET contract_id=NULL WHERE machine_id=? AND contract_id=?`, [req.params.machineId, req.params.contractId]
    );
    if (!r.affectedRows) return fail(res, 404, "Machine is not on this contract");
    await audit(req, "CONTRACT_MACHINE_DETACHED", { machineId: req.params.machineId, details: { contractId: Number(req.params.contractId) } });
    res.json({ success: true });
  } catch (err) {
    console.error("CONTRACT DETACH ERROR:", err);
    res.status(500).json({ error: "Failed to unlink machine" });
  }
};

exports.CONTRACT_TYPES = CONTRACT_TYPES;
