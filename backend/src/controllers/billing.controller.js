// src/controllers/billing.controller.js
// Invoices (GST receipts + monthly department invoices) and revenue-share
// settlements. Shared by admin (all) and officers (their organisations).
const db = require("../database/db");
const invoices = require("../services/invoice.service");
const { audit } = require("../services/audit.service");
const { isYmd, dayRange } = require("../services/time.service");
const { round2 } = require("../services/pricing.service");

const fail = (res, status, error) => res.status(status).json({ error });

/* Filters → SQL. scopeOrgIds limits to organisations (officers). */
function invoiceWhere(q, scopeOrgIds) {
  const where = [];
  const params = [];
  if (q.type) { where.push("i.invoice_type=?"); params.push(q.type); }
  if (q.status) { where.push("i.status=?"); params.push(q.status); }
  if (q.contractId) { where.push("i.contract_id=?"); params.push(Number(q.contractId)); }
  if (q.organizationId) { where.push("i.organization_id=?"); params.push(Number(q.organizationId)); }
  if (isYmd(q.from) && isYmd(q.to)) {
    const { start, end } = dayRange(q.from, q.to);
    where.push("i.issued_at >= ? AND i.issued_at < ?"); params.push(start, end);
  }
  if (scopeOrgIds) {
    where.push(scopeOrgIds.length ? "i.organization_id IN (?)" : "FALSE");
    if (scopeOrgIds.length) params.push(scopeOrgIds);
  }
  return { sql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

/* GET invoices list */
exports.listInvoices = (scoped = false) => async (req, res) => {
  try {
    const q = { ...req.query };
    if (scoped && !q.type) q.type = "DEPARTMENT";
    const w = invoiceWhere(q, scoped ? req.staff.orgIds : null);
    const [rows] = await db.query(
      `SELECT i.id, i.invoice_no, i.invoice_type, i.is_tax_invoice, i.job_id, i.contract_id, c.contract_no,
              i.organization_id, o.name AS organization_name, i.machine_id, i.period_start, i.period_end,
              i.buyer_name, i.taxable_amount, i.cgst, i.sgst, i.igst, i.total, i.status, i.issued_at, i.due_date, i.paid_at
       FROM invoices i
       LEFT JOIN contracts c ON c.id=i.contract_id
       LEFT JOIN organizations o ON o.id=i.organization_id
       ${w.sql}
       ORDER BY i.issued_at DESC, i.id DESC
       LIMIT ${Math.min(Number(req.query.limit) || 200, 1000)}`,
      w.params
    );
    res.json(rows);
  } catch (err) {
    console.error("INVOICE LIST ERROR:", err);
    res.status(500).json({ error: "Failed to load invoices" });
  }
};

async function loadInvoice(req, scoped) {
  const [[inv]] = await db.query(`SELECT * FROM invoices WHERE id=?`, [Number(req.params.invoiceId)]);
  if (!inv) return null;
  if (scoped && !req.staff.orgIds.includes(inv.organization_id)) return null;
  if (typeof inv.line_items === "string") inv.line_items = JSON.parse(inv.line_items);
  return inv;
}

exports.getInvoice = (scoped = false) => async (req, res) => {
  try {
    const inv = await loadInvoice(req, scoped);
    if (!inv) return fail(res, 404, "Invoice not found");
    res.json(inv);
  } catch (err) {
    console.error("INVOICE GET ERROR:", err);
    res.status(500).json({ error: "Failed to load invoice" });
  }
};

exports.invoicePdf = (scoped = false) => async (req, res) => {
  try {
    const inv = await loadInvoice(req, scoped);
    if (!inv) return fail(res, 404, "Invoice not found");
    const pdf = await invoices.renderInvoicePdf(inv);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${inv.invoice_no.replace(/\//g, "-")}.pdf"`);
    res.end(pdf);
  } catch (err) {
    console.error("INVOICE PDF ERROR:", err);
    res.status(500).json({ error: "Could not create the PDF" });
  }
};

/* POST /api/admin/invoices/generate
   { contractId, periodStart, periodEnd, extraLines?, includeAmc?, preview?, force? } */
exports.generateInvoice = async (req, res) => {
  try {
    const { contractId, periodStart, periodEnd, extraLines, includeAmc, preview, force } = req.body;
    const built = await invoices.buildDepartmentInvoice({ contractId, periodStart, periodEnd, extraLines, includeAmc });
    if (preview) return res.json({ preview: true, ...built.invoice, total: built.total, tax: built.tax });
    if (!built.invoice.line_items.length) return fail(res, 400, "Nothing to invoice in this period");
    if (!(built.total > 0)) return fail(res, 400, "The invoice total must be more than ₹0");
    const [[overlap]] = await db.query(
      `SELECT invoice_no FROM invoices WHERE contract_id=? AND invoice_type='DEPARTMENT' AND status<>'CANCELLED'
         AND period_start <= ? AND period_end >= ? LIMIT 1`,
      [contractId, periodEnd, periodStart]
    );
    if (overlap && !force) return fail(res, 409, `Invoice ${overlap.invoice_no} already covers part of this period`);
    const inv = await invoices.saveInvoice(built.invoice, req.staff.id);
    await audit(req, "INVOICE_GENERATED", { details: { id: inv.id, invoiceNo: inv.invoice_no, contractId, total: built.total } });
    res.json({ success: true, ...inv, total: built.total });
  } catch (err) {
    if (err.status) return fail(res, err.status, err.message);
    console.error("INVOICE GENERATE ERROR:", err);
    res.status(500).json({ error: "Failed to generate invoice" });
  }
};

/* POST /api/admin/invoices/manual
   { organizationId?, contractId?, buyerName, buyerGstin?, buyerAddress?, placeOfSupply?, lines:[{description, quantity, rate, unit?}] } */
exports.manualInvoice = async (req, res) => {
  try {
    const b = req.body;
    const lines = (Array.isArray(b.lines) ? b.lines : [])
      .filter((l) => l.description && Number.isFinite(Number(l.rate)))
      .map((l) => ({
        description: String(l.description).slice(0, 200), sac: l.sac || null, quantity: Number(l.quantity) || 1,
        unit: l.unit || "", rate: Number(l.rate), amount: round2((Number(l.quantity) || 1) * Number(l.rate)),
      }));
    if (!b.buyerName || !lines.length) return fail(res, 400, "buyerName and at least one line are required");
    const total = round2(lines.reduce((s, l) => s + l.amount, 0));
    if (!(total > 0)) return fail(res, 400, "The invoice total must be more than ₹0");
    const inv = await invoices.saveInvoice({
      invoice_type: "MANUAL", organization_id: Number(b.organizationId) || null, contract_id: Number(b.contractId) || null,
      buyer_name: String(b.buyerName).slice(0, 200), buyer_gstin: b.buyerGstin || null, buyer_address: b.buyerAddress || null,
      place_of_supply: b.placeOfSupply || null, line_items: lines, notes: b.notes || null,
    }, req.staff.id);
    await audit(req, "INVOICE_GENERATED", { details: { id: inv.id, invoiceNo: inv.invoice_no, manual: true, total } });
    res.json({ success: true, ...inv });
  } catch (err) {
    console.error("MANUAL INVOICE ERROR:", err);
    res.status(500).json({ error: "Failed to create invoice" });
  }
};

/* PATCH /api/admin/invoices/:invoiceId  { status: "PAID", paymentRef } | { status: "CANCELLED", reason } */
exports.updateInvoice = async (req, res) => {
  try {
    const id = Number(req.params.invoiceId);
    const [[inv]] = await db.query(`SELECT id, invoice_no, status, invoice_type FROM invoices WHERE id=?`, [id]);
    if (!inv) return fail(res, 404, "Invoice not found");
    const { status } = req.body;
    if (status === "PAID") {
      if (inv.status !== "ISSUED") return fail(res, 409, `Invoice is ${inv.status}`);
      await db.query(`UPDATE invoices SET status='PAID', paid_at=NOW(), payment_ref=? WHERE id=?`,
        [req.body.paymentRef ? String(req.body.paymentRef).slice(0, 100) : null, id]);
    } else if (status === "CANCELLED") {
      if (inv.status === "CANCELLED") return fail(res, 409, "Already cancelled");
      const reason = String(req.body.reason || "").trim();
      if (!reason) return fail(res, 400, "A reason is required to cancel an invoice");
      await db.query(`UPDATE invoices SET status='CANCELLED', cancelled_reason=? WHERE id=?`, [reason.slice(0, 255), id]);
    } else {
      return fail(res, 400, "status must be PAID or CANCELLED");
    }
    await audit(req, `INVOICE_${status}`, { details: { id, invoiceNo: inv.invoice_no } });
    res.json({ success: true });
  } catch (err) {
    console.error("INVOICE UPDATE ERROR:", err);
    res.status(500).json({ error: "Failed to update invoice" });
  }
};

/* ═════════════ SETTLEMENTS (revenue share) ═════════════ */

exports.listSettlements = (scoped = false) => async (req, res) => {
  try {
    const where = [];
    const params = [];
    if (req.query.status) { where.push("s.status=?"); params.push(req.query.status); }
    if (req.query.contractId) { where.push("s.contract_id=?"); params.push(Number(req.query.contractId)); }
    if (scoped) {
      where.push(req.staff.orgIds.length ? "s.organization_id IN (?)" : "FALSE");
      if (req.staff.orgIds.length) params.push(req.staff.orgIds);
    }
    const [rows] = await db.query(
      `SELECT s.*, c.contract_no, o.name AS organization_name, v.full_name AS vendor_name
       FROM settlements s
       JOIN contracts c ON c.id=s.contract_id
       JOIN organizations o ON o.id=s.organization_id
       LEFT JOIN vendors v ON v.id=s.vendor_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY s.period_start DESC, s.id DESC LIMIT 500`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error("SETTLEMENT LIST ERROR:", err);
    res.status(500).json({ error: "Failed to load settlements" });
  }
};

/* POST /api/admin/settlements/generate  { contractId, periodStart, periodEnd, preview? }
   gross = citizen payments for PRINTED orders on the contract in the period
   share = gross × revenue_share_pct → paid to the office (PAY_TO_ORG) */
exports.generateSettlement = async (req, res) => {
  try {
    const { contractId, periodStart, periodEnd, preview } = req.body;
    if (!isYmd(periodStart) || !isYmd(periodEnd) || periodStart > periodEnd) return fail(res, 400, "periodStart and periodEnd must be dates");
    const [[c]] = await db.query(`SELECT * FROM contracts WHERE id=?`, [contractId]);
    if (!c) return fail(res, 404, "Contract not found");
    if (c.contract_type !== "REVENUE_SHARE") return fail(res, 400, "Settlements are for REVENUE_SHARE contracts");
    const { start, end } = dayRange(periodStart, periodEnd);
    const [[g]] = await db.query(
      `SELECT COALESCE(SUM(amount),0) AS gross, COUNT(*) AS orders FROM print_jobs
       WHERE contract_id=? AND billing='CUSTOMER' AND status='PRINTED' AND printed_at >= ? AND printed_at < ?`,
      [c.id, start, end]
    );
    const gross = round2(g.gross);
    const pct = Number(c.revenue_share_pct) || 0;
    const share = round2((gross * pct) / 100);
    const result = { contractId: c.id, periodStart, periodEnd, orders: Number(g.orders), grossRevenue: gross, sharePct: pct, shareAmount: share };
    if (preview) return res.json({ preview: true, ...result });
    const [[overlap]] = await db.query(
      `SELECT id FROM settlements WHERE contract_id=? AND status<>'CANCELLED' AND period_start <= ? AND period_end >= ? LIMIT 1`,
      [c.id, periodEnd, periodStart]
    );
    if (overlap) return fail(res, 409, `Settlement #${overlap.id} already covers part of this period`);
    const [r] = await db.query(
      `INSERT INTO settlements (contract_id, organization_id, vendor_id, period_start, period_end, gross_revenue,
         share_pct, share_amount, direction, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PAY_TO_ORG', 'PENDING', ?)`,
      [c.id, c.organization_id, c.vendor_id, periodStart, periodEnd, gross, pct, share, req.staff.id]
    );
    await audit(req, "SETTLEMENT_CREATED", { details: { id: r.insertId, ...result } });
    res.json({ success: true, id: r.insertId, ...result });
  } catch (err) {
    console.error("SETTLEMENT GENERATE ERROR:", err);
    res.status(500).json({ error: "Failed to generate settlement" });
  }
};

/* PATCH /api/admin/settlements/:settlementId  { status: APPROVED|PAID|CANCELLED, reference?, notes? } */
exports.updateSettlement = async (req, res) => {
  try {
    const id = Number(req.params.settlementId);
    const [[s]] = await db.query(`SELECT * FROM settlements WHERE id=?`, [id]);
    if (!s) return fail(res, 404, "Settlement not found");
    const { status } = req.body;
    const allowed = { PENDING: ["APPROVED", "CANCELLED"], APPROVED: ["PAID", "CANCELLED"], PAID: [], CANCELLED: [] };
    if (!allowed[s.status].includes(status)) return fail(res, 409, `Can't change a ${s.status} settlement to ${status}`);
    if (status === "PAID" && !req.body.reference) return fail(res, 400, "Payment reference (UTR) is required");
    await db.query(
      `UPDATE settlements SET status=?, reference=COALESCE(?, reference), notes=COALESCE(?, notes),
         approved_by=IF(?='APPROVED', ?, approved_by), approved_at=IF(?='APPROVED', NOW(), approved_at),
         paid_at=IF(?='PAID', NOW(), paid_at)
       WHERE id=?`,
      [status, req.body.reference ? String(req.body.reference).slice(0, 100) : null,
       req.body.notes ? String(req.body.notes).slice(0, 500) : null, status, req.staff.id, status, status, id]
    );
    await audit(req, `SETTLEMENT_${status}`, { details: { id, amount: s.share_amount, reference: req.body.reference || null } });
    res.json({ success: true });
  } catch (err) {
    console.error("SETTLEMENT UPDATE ERROR:", err);
    res.status(500).json({ error: "Failed to update settlement" });
  }
};
