// src/controllers/pricing.controller.js
// Admin: approved per-unit rates with history.
//   create (PENDING) → approve (ACTIVE, with the office order / approval reference)
//   → retire (RETIRED, effective_to set). Approved rules are never edited.
const db = require("../database/db");
const { audit } = require("../services/audit.service");
const { isYmd, today } = require("../services/time.service");
const machines = require("../services/machine.service");
const { priceTable } = require("../services/pricing.service");

const fail = (res, status, error) => res.status(status).json({ error });

/* GET /api/admin/pricing-rules?status&scope&machineId&contractId */
exports.listRules = async (req, res) => {
  try {
    const where = [];
    const params = [];
    const { status, scope, machineId, contractId } = req.query;
    if (status) { where.push("r.status=?"); params.push(status); }
    if (scope) { where.push("r.scope=?"); params.push(scope); }
    if (machineId) { where.push("r.machine_id=?"); params.push(machineId); }
    if (contractId) { where.push("r.contract_id=?"); params.push(contractId); }
    const [rows] = await db.query(
      `SELECT r.*, c.contract_no, o.name AS organization_name, m.name AS machine_name,
              cb.name AS created_by_name, ab.name AS approved_by_name
       FROM pricing_rules r
       LEFT JOIN contracts c ON c.id = r.contract_id
       LEFT JOIN organizations o ON o.id = c.organization_id
       LEFT JOIN machines m ON m.machine_id = r.machine_id
       LEFT JOIN admin_users cb ON cb.id = r.created_by
       LEFT JOIN admin_users ab ON ab.id = r.approved_by
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY FIELD(r.status,'PENDING','ACTIVE','RETIRED','REJECTED'), r.scope, r.effective_from DESC, r.id DESC
       LIMIT 500`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error("PRICING LIST ERROR:", err);
    res.status(500).json({ error: "Failed to load pricing rules" });
  }
};

/* POST /api/admin/pricing-rules
   { scope, contractId?, machineId?, jobType, color, paperSize, printSide, rate, effectiveFrom, notes? } */
exports.createRule = async (req, res) => {
  try {
    const b = req.body;
    const scope = ["GLOBAL", "CONTRACT", "MACHINE"].includes(b.scope) ? b.scope : null;
    if (!scope) return fail(res, 400, "scope must be GLOBAL, CONTRACT or MACHINE");
    const jobType = ["ANY", "PRINT", "COPY", "SCAN", "FORM"].includes(b.jobType) ? b.jobType : "ANY";
    const color = ["any", "bw", "color"].includes(b.color) ? b.color : "any";
    const paperSize = ["any", "A4", "A3"].includes(b.paperSize) ? b.paperSize : "any";
    const printSide = ["any", "single", "duplex"].includes(b.printSide) ? b.printSide : "any";
    const rate = Number(b.rate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 10000) return fail(res, 400, "Rate must be a number between 0 and 10000");
    const effectiveFrom = isYmd(b.effectiveFrom) ? b.effectiveFrom : today();
    let contractId = null;
    let machineId = null;
    if (scope === "CONTRACT") {
      const [[c]] = await db.query(`SELECT id FROM contracts WHERE id=?`, [b.contractId]);
      if (!c) return fail(res, 404, "Contract not found");
      contractId = c.id;
    }
    if (scope === "MACHINE") {
      const m = await machines.getMachine(String(b.machineId || ""));
      if (!m) return fail(res, 404, "Machine not found");
      machineId = m.machine_id;
    }
    const [r] = await db.query(
      `INSERT INTO pricing_rules (scope, contract_id, machine_id, job_type, color, paper_size, print_side, rate,
         status, effective_from, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)`,
      [scope, contractId, machineId, jobType, color, paperSize, printSide, rate, effectiveFrom,
       b.notes ? String(b.notes).slice(0, 500) : null, req.staff.id]
    );
    await audit(req, "PRICING_RULE_CREATED", { machineId, details: { id: r.insertId, scope, contractId, jobType, color, paperSize, printSide, rate } });
    res.json({ success: true, id: r.insertId });
  } catch (err) {
    console.error("PRICING CREATE ERROR:", err);
    res.status(500).json({ error: "Failed to create pricing rule" });
  }
};

/* POST /api/admin/pricing-rules/:ruleId/approve  { approvalRef }
   Activating a rule retires any older ACTIVE rule with exactly the same scope
   and options (its effective_to becomes the day before). */
exports.approveRule = async (req, res) => {
  try {
    const id = Number(req.params.ruleId);
    const ref = String(req.body.approvalRef || "").trim();
    if (!ref) return fail(res, 400, "Approval reference (e.g. office order no.) is required");
    const [[r]] = await db.query(`SELECT * FROM pricing_rules WHERE id=?`, [id]);
    if (!r) return fail(res, 404, "Rule not found");
    if (r.status !== "PENDING") return fail(res, 409, `Rule is ${r.status}`);
    const [replaced] = await db.query(
      `UPDATE pricing_rules SET status='RETIRED', retired_at=NOW(),
         effective_to=GREATEST(effective_from, DATE_SUB(?, INTERVAL 1 DAY))
       WHERE status='ACTIVE' AND id<>? AND scope=? AND contract_id <=> ? AND machine_id <=> ?
         AND job_type=? AND color=? AND paper_size=? AND print_side=?`,
      [r.effective_from, id, r.scope, r.contract_id, r.machine_id, r.job_type, r.color, r.paper_size, r.print_side]
    );
    await db.query(
      `UPDATE pricing_rules SET status='ACTIVE', approval_ref=?, approved_by=?, approved_at=NOW() WHERE id=?`,
      [ref.slice(0, 120), req.staff.id, id]
    );
    await audit(req, "PRICING_RULE_APPROVED", { machineId: r.machine_id, details: { id, approvalRef: ref, rate: r.rate, replaced: replaced.affectedRows } });
    res.json({ success: true, replaced: replaced.affectedRows });
  } catch (err) {
    console.error("PRICING APPROVE ERROR:", err);
    res.status(500).json({ error: "Failed to approve rule" });
  }
};

/* POST /api/admin/pricing-rules/:ruleId/reject  { notes? } */
exports.rejectRule = async (req, res) => {
  try {
    const id = Number(req.params.ruleId);
    const [r] = await db.query(
      `UPDATE pricing_rules SET status='REJECTED', notes=COALESCE(?, notes) WHERE id=? AND status='PENDING'`,
      [req.body.notes ? String(req.body.notes).slice(0, 500) : null, id]
    );
    if (!r.affectedRows) return fail(res, 409, "Only PENDING rules can be rejected");
    await audit(req, "PRICING_RULE_REJECTED", { details: { id } });
    res.json({ success: true });
  } catch (err) {
    console.error("PRICING REJECT ERROR:", err);
    res.status(500).json({ error: "Failed to reject rule" });
  }
};

/* POST /api/admin/pricing-rules/:ruleId/retire — prices fall back to the next matching rule / defaults */
exports.retireRule = async (req, res) => {
  try {
    const id = Number(req.params.ruleId);
    const [r] = await db.query(
      `UPDATE pricing_rules SET status='RETIRED', retired_at=NOW(), effective_to=GREATEST(effective_from, ?)
       WHERE id=? AND status='ACTIVE'`,
      [today(), id]
    );
    if (!r.affectedRows) return fail(res, 409, "Only ACTIVE rules can be retired");
    await audit(req, "PRICING_RULE_RETIRED", { details: { id } });
    res.json({ success: true });
  } catch (err) {
    console.error("PRICING RETIRE ERROR:", err);
    res.status(500).json({ error: "Failed to retire rule" });
  }
};

/* GET /api/admin/pricing/preview?machineId=MH1000 → the rates that machine charges today */
exports.preview = async (req, res) => {
  try {
    const ctx = await machines.getContext(String(req.query.machineId || ""));
    if (!ctx) return fail(res, 404, "Machine not found");
    res.json({ machineId: ctx.machine_id, contractId: ctx.activeContractId, jobTypes: ctx.jobTypes, table: await priceTable(ctx, ctx.jobTypes) });
  } catch (err) {
    console.error("PRICING PREVIEW ERROR:", err);
    res.status(500).json({ error: "Failed to preview prices" });
  }
};
