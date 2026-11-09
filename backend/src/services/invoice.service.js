// src/services/invoice.service.js
// GST invoices and receipts, numbered per financial year.
//
//   R series — one receipt per paid citizen order (created when it prints)
//   D series — monthly invoice to a department (PAY_PER_USE / RENTAL / AMC),
//              with SLA penalties deducted
//   M series — anything typed by hand in the admin panel
//
// Prices are GST-inclusive. With SELLER_GSTIN set, documents are tax
// invoices with CGST+SGST (same state) or IGST (other state); without it
// they are plain receipts / bills. Ask your CA to confirm the rate and SAC.
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const db = require("../database/db");
const env = require("../config/env");
const { financialYear, toLocal, ymd, isYmd } = require("./time.service");
const { round2 } = require("./pricing.service");

const SERIES = { CUSTOMER_RECEIPT: "R", DEPARTMENT: "D", MANUAL: "M" };

function formatNo(series, fy, n) {
  const fixed = env.INVOICE_PREFIX.length + 1 + fy.length + 1 + series.length;
  const digits = Math.max(4, 16 - fixed);
  return `${env.INVOICE_PREFIX}/${fy}/${series}${String(n).padStart(digits, "0")}`;
}

/* Next number in the series — call inside a transaction (row lock keeps it gap-free). */
async function nextNumber(conn, series, fy) {
  await conn.query(
    `INSERT INTO invoice_sequences (series, financial_year, last_no) VALUES (?, ?, 0)
     ON DUPLICATE KEY UPDATE last_no=last_no`,
    [series, fy]
  );
  const [[row]] = await conn.query(
    `SELECT last_no FROM invoice_sequences WHERE series=? AND financial_year=? FOR UPDATE`, [series, fy]
  );
  const n = Number(row.last_no) + 1;
  await conn.query(`UPDATE invoice_sequences SET last_no=? WHERE series=? AND financial_year=?`, [n, series, fy]);
  return formatNo(series, fy, n);
}

const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

/* Split a GST-inclusive total into taxable value + tax. */
function computeTax(total, placeOfSupply) {
  total = round2(total);
  if (!env.SELLER_GSTIN || !(env.INVOICE_GST_RATE > 0)) {
    return { isTax: false, taxable: total, cgst: 0, sgst: 0, igst: 0, total };
  }
  const taxable = round2(total / (1 + env.INVOICE_GST_RATE / 100));
  const tax = round2(total - taxable);
  const intra = !placeOfSupply || norm(placeOfSupply) === norm(env.SELLER_STATE);
  if (intra) {
    const cgst = round2(tax / 2);
    return { isTax: true, taxable, cgst, sgst: round2(tax - cgst), igst: 0, total };
  }
  return { isTax: true, taxable, cgst: 0, sgst: 0, igst: tax, total };
}

function seller() {
  return { seller_name: env.SELLER_NAME, seller_gstin: env.SELLER_GSTIN || null, seller_address: env.SELLER_ADDRESS || null };
}

async function insertInvoice(conn, inv) {
  const fy = financialYear(new Date());
  const series = SERIES[inv.invoice_type];
  const invoiceNo = await nextNumber(conn, series, fy);
  const lines = inv.line_items.map((l) => ({ ...l, amount: round2(l.amount) }));
  const total = round2(lines.reduce((s, l) => s + l.amount, 0));
  const tax = computeTax(total, inv.place_of_supply);
  const [r] = await conn.query(
    `INSERT INTO invoices
       (invoice_no, series, financial_year, invoice_type, is_tax_invoice, job_id, contract_id, organization_id,
        vendor_id, machine_id, period_start, period_end, buyer_name, buyer_gstin, buyer_address, place_of_supply,
        seller_name, seller_gstin, seller_address, line_items, taxable_amount, cgst, sgst, igst, total,
        status, due_date, notes, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      invoiceNo, series, fy, inv.invoice_type, tax.isTax ? 1 : 0, inv.job_id || null, inv.contract_id || null,
      inv.organization_id || null, inv.vendor_id || null, inv.machine_id || null, inv.period_start || null,
      inv.period_end || null, inv.buyer_name || null, inv.buyer_gstin || null, inv.buyer_address || null,
      inv.place_of_supply || null, ...Object.values(seller()), JSON.stringify(lines), tax.taxable, tax.cgst,
      tax.sgst, tax.igst, tax.total, inv.status || "ISSUED", inv.due_date || null, inv.notes || null,
      inv.created_by || null,
    ]
  );
  return { id: r.insertId, invoice_no: invoiceNo };
}

/* Describe a print job in one invoice line. */
function jobLine(job) {
  const copies = Number(job.copies) || 1;
  const pages = Number(job.total_pages) || 0;
  const what = {
    PRINT: "Document printing",
    FORM: `Form printing${job.form_title ? ` — ${job.form_title}` : ""}`,
    COPY: "Photocopying",
    SCAN: "Scanning to PDF",
  }[job.job_type || "PRINT"];
  const opts = job.job_type === "SCAN"
    ? `${pages} page${pages === 1 ? "" : "s"}, ${job.color === "color" ? "colour" : "B&W"}`
    : `${pages} page${pages === 1 ? "" : "s"} × ${copies} cop${copies === 1 ? "y" : "ies"}, ` +
      `${job.color === "color" ? "colour" : "B&W"}, ${job.print_side === "duplex" ? "double-sided" : "single-sided"}, ${job.paper_size || "A4"}`;
  const amount = Number(job.amount) || 0;
  const rate = Number(job.unit_rate) || 0;
  const quantity = rate > 0 ? Math.round(amount / rate) : 1;
  return {
    description: `${what} (${opts}) — order ${job.order_code || job.job_id}`,
    sac: env.INVOICE_SAC || null,
    quantity,
    unit: job.job_type === "SCAN" ? "page" : job.print_side === "duplex" ? "sheet" : "page",
    rate: rate || amount,
    amount,
  };
}

/* One receipt per paid citizen order. Safe to call twice. → invoice id or null */
async function createCustomerReceipt(jobId) {
  const conn = await db.getConnection();
  let tx = false;
  try {
    await conn.beginTransaction();
    tx = true;
    const [[job]] = await conn.query(
      `SELECT pj.*, ft.title AS form_title, l.state AS location_state, m.owner_vendor_id
       FROM print_jobs pj
       LEFT JOIN machines m ON m.machine_id = pj.machine_id
       LEFT JOIN locations l ON l.id = m.location_id
       LEFT JOIN form_templates ft ON ft.id = pj.form_template_id
       WHERE pj.job_id=? FOR UPDATE`,
      [jobId]
    );
    const skip = !job || job.billing !== "CUSTOMER" || !(Number(job.amount) > 0) || job.status !== "PRINTED";
    const [[existing]] = job ? await conn.query(`SELECT id FROM invoices WHERE job_id=?`, [jobId]) : [[null]];
    if (skip || existing) {
      await conn.rollback();
      tx = false;
      return existing ? existing.id : null;
    }
    const inv = await insertInvoice(conn, {
      invoice_type: "CUSTOMER_RECEIPT",
      job_id: job.job_id,
      machine_id: job.machine_id,
      organization_id: job.organization_id,
      contract_id: job.contract_id,
      vendor_id: job.owner_vendor_id,
      buyer_name: "Walk-in customer",
      place_of_supply: job.location_state || env.SELLER_STATE,
      line_items: [jobLine(job)],
      status: "PAID",
    });
    await conn.query(`UPDATE invoices SET paid_at=NOW(), payment_ref=? WHERE id=?`, [job.payment_id || null, inv.id]);
    await conn.commit();
    tx = false;
    return inv.id;
  } catch (err) {
    if (tx) await conn.rollback().catch(() => {});
    console.error("RECEIPT ERROR:", jobId, err.message);
    return null;
  } finally {
    conn.release();
  }
}

/* Lines for a department invoice. Throws { status, message } for bad input. */
async function buildDepartmentInvoice({ contractId, periodStart, periodEnd, extraLines = [], includeAmc = false }) {
  if (!isYmd(periodStart) || !isYmd(periodEnd) || periodStart > periodEnd)
    throw httpError(400, "periodStart and periodEnd must be dates (YYYY-MM-DD)");
  const [[c]] = await db.query(
    `SELECT c.*, o.name AS org_name, o.gstin AS org_gstin, o.address AS org_address, o.city AS org_city,
            o.state AS org_state, o.pincode AS org_pincode
     FROM contracts c JOIN organizations o ON o.id = c.organization_id WHERE c.id=?`,
    [contractId]
  );
  if (!c) throw httpError(404, "Contract not found");

  const lines = [];
  // Printed department-billed orders, grouped by kind and rate
  const [usage] = await db.query(
    `SELECT job_type, color, print_side, paper_size, unit_rate,
            COUNT(*) AS orders, SUM(amount) AS amount,
            SUM(CASE WHEN unit_rate > 0 THEN ROUND(amount / unit_rate) ELSE 0 END) AS units
     FROM print_jobs
     WHERE contract_id=? AND billing='DEPARTMENT' AND status='PRINTED'
       AND printed_at >= ? AND printed_at < ? + INTERVAL 1 DAY
     GROUP BY job_type, color, print_side, paper_size, unit_rate
     ORDER BY job_type, color, print_side`,
    [contractId, localStartUtc(periodStart), localStartUtc(periodEnd)]
  );
  const label = { PRINT: "Document printing", FORM: "Form printing", COPY: "Photocopying", SCAN: "Scanning" };
  for (const u of usage) {
    const unit = u.job_type === "SCAN" ? "page" : u.print_side === "duplex" ? "sheet" : "page";
    lines.push({
      description: `${label[u.job_type] || u.job_type} — ${u.color === "color" ? "colour" : "B&W"}` +
        `${u.job_type === "SCAN" ? "" : `, ${u.print_side === "duplex" ? "double-sided" : "single-sided"}, ${u.paper_size || "A4"}`}` +
        ` (${u.orders} order${Number(u.orders) === 1 ? "" : "s"})`,
      sac: env.INVOICE_SAC || null,
      quantity: Number(u.units) || Number(u.orders),
      unit,
      rate: Number(u.unit_rate) || 0,
      amount: Number(u.amount) || 0,
    });
  }

  if (c.contract_type === "RENTAL" && Number(c.rental_amount_monthly) > 0) {
    const months = monthsBetween(periodStart, periodEnd);
    lines.push({
      description: `Machine rental — ${months} month${months === 1 ? "" : "s"} (${periodStart} to ${periodEnd})`,
      sac: env.INVOICE_SAC || null, quantity: months, unit: "month",
      rate: Number(c.rental_amount_monthly), amount: months * Number(c.rental_amount_monthly),
    });
  }
  if (includeAmc && Number(c.amc_amount) > 0) {
    lines.push({
      description: `Annual maintenance contract (AMC)${c.amc_until ? ` until ${c.amc_until}` : ""}`,
      sac: env.INVOICE_SAC || null, quantity: 1, unit: "year", rate: Number(c.amc_amount), amount: Number(c.amc_amount),
    });
  }

  // SLA penalties for months inside the period
  const [sla] = await db.query(
    `SELECT s.machine_id, DATE_FORMAT(s.month, '%Y-%m') AS month, s.uptime_pct, s.penalty_amount
     FROM sla_reports s
     WHERE s.contract_id=? AND s.month >= DATE_FORMAT(?, '%Y-%m-01') AND s.month <= ? AND s.penalty_amount > 0`,
    [contractId, periodStart, periodEnd]
  );
  for (const s of sla) {
    lines.push({
      description: `SLA penalty — ${s.machine_id}, ${s.month}: uptime ${Number(s.uptime_pct).toFixed(2)}% (target ${Number(c.sla_uptime_pct)}%)`,
      sac: null, quantity: 1, unit: "", rate: -Number(s.penalty_amount), amount: -Number(s.penalty_amount),
    });
  }

  for (const x of Array.isArray(extraLines) ? extraLines : []) {
    const quantity = Number(x.quantity) || 1;
    const rate = Number(x.rate);
    if (!x.description || !Number.isFinite(rate)) continue;
    lines.push({
      description: String(x.description).slice(0, 200), sac: x.sac || env.INVOICE_SAC || null,
      quantity, unit: x.unit || "", rate, amount: round2(quantity * rate),
    });
  }

  const total = round2(lines.reduce((s, l) => s + Number(l.amount), 0));
  const address = [c.org_address, c.org_city, c.org_state, c.org_pincode].filter(Boolean).join(", ");
  return {
    contract: c,
    invoice: {
      invoice_type: "DEPARTMENT",
      contract_id: c.id,
      organization_id: c.organization_id,
      vendor_id: c.vendor_id,
      period_start: periodStart,
      period_end: periodEnd,
      buyer_name: c.org_name,
      buyer_gstin: c.org_gstin,
      buyer_address: address || null,
      place_of_supply: c.org_state || env.SELLER_STATE,
      line_items: lines,
      notes: [c.gem_contract_no ? `GeM contract ${c.gem_contract_no}` : null, c.po_number ? `PO ${c.po_number}` : null]
        .filter(Boolean).join(" · ") || null,
    },
    total,
    tax: computeTax(total, c.org_state || env.SELLER_STATE),
  };
}

async function saveInvoice(invoice, createdBy) {
  const conn = await db.getConnection();
  let tx = false;
  try {
    await conn.beginTransaction();
    tx = true;
    const due = new Date(Date.now() + env.INVOICE_DUE_DAYS * 86400000);
    const inv = await insertInvoice(conn, { ...invoice, created_by: createdBy, due_date: ymd(toLocal(due)) });
    await conn.commit();
    tx = false;
    return inv;
  } catch (err) {
    if (tx) await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/* ── PDF ── */
async function renderInvoicePdf(inv) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.1, 0.12, 0.18);
  const muted = rgb(0.42, 0.45, 0.52);
  let y = 800;
  const text = (s, x, yy, opts = {}) =>
    page.drawText(ascii(s), { x, y: yy, size: opts.size || 9, font: opts.bold ? bold : font, color: opts.color || ink });
  const right = (s, xr, yy, opts = {}) => {
    const f = opts.bold ? bold : font;
    const w = f.widthOfTextAtSize(ascii(s), opts.size || 9);
    text(s, xr - w, yy, opts);
  };

  const title = inv.invoice_type === "CUSTOMER_RECEIPT"
    ? inv.is_tax_invoice ? "TAX INVOICE (RECEIPT)" : "RECEIPT"
    : inv.is_tax_invoice ? "TAX INVOICE" : "BILL OF SUPPLY";
  text(inv.seller_name || env.SELLER_NAME, 40, y, { bold: true, size: 15 });
  right(title, 555, y, { bold: true, size: 13 });
  y -= 16;
  if (inv.seller_address) { wrap(inv.seller_address, 60).forEach((l) => { text(l, 40, y, { color: muted }); y -= 11; }); }
  if (inv.seller_gstin) { text(`GSTIN: ${inv.seller_gstin}`, 40, y, { color: muted }); y -= 11; }

  let ry = 784;
  right(`No. ${inv.invoice_no}`, 555, ry, { bold: true }); ry -= 12;
  right(`Date: ${fmtDate(inv.issued_at)}`, 555, ry); ry -= 12;
  if (inv.due_date && inv.status !== "PAID") { right(`Due: ${inv.due_date}`, 555, ry); ry -= 12; }
  if (inv.period_start) { right(`Period: ${inv.period_start} to ${inv.period_end}`, 555, ry); ry -= 12; }
  right(`Status: ${inv.status}`, 555, ry);

  y = Math.min(y, ry) - 22;
  page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.6, color: muted });
  y -= 16;
  text("Bill to", 40, y, { bold: true, color: muted }); y -= 12;
  text(inv.buyer_name || "Customer", 40, y, { bold: true }); y -= 11;
  if (inv.buyer_address) wrap(inv.buyer_address, 70).forEach((l) => { text(l, 40, y); y -= 11; });
  if (inv.buyer_gstin) { text(`GSTIN: ${inv.buyer_gstin}`, 40, y); y -= 11; }
  if (inv.place_of_supply) { text(`Place of supply: ${inv.place_of_supply}`, 40, y, { color: muted }); y -= 11; }

  y -= 14;
  const cols = { d: 40, sac: 300, q: 365, r: 435, a: 555 };
  page.drawRectangle({ x: 36, y: y - 4, width: 523, height: 16, color: rgb(0.94, 0.95, 0.98) });
  text("Description", cols.d, y, { bold: true });
  text("SAC", cols.sac, y, { bold: true });
  right("Qty", cols.q + 30, y, { bold: true });
  right("Rate", cols.r + 30, y, { bold: true });
  right("Amount (Rs.)", cols.a, y, { bold: true });
  y -= 18;
  const lines = typeof inv.line_items === "string" ? JSON.parse(inv.line_items) : inv.line_items || [];
  for (const l of lines) {
    const desc = wrap(l.description, 48);
    desc.forEach((d, i) => text(d, cols.d, y - i * 11));
    text(l.sac || "", cols.sac, y);
    right(`${l.quantity ?? ""}${l.unit ? ` ${l.unit}` : ""}`, cols.q + 30, y);
    right(money(l.rate), cols.r + 30, y);
    right(money(l.amount), cols.a, y);
    y -= Math.max(1, desc.length) * 11 + 6;
    if (y < 160) break; // keep the totals on page 1
  }
  page.drawLine({ start: { x: 300, y: y + 2 }, end: { x: 555, y: y + 2 }, thickness: 0.6, color: muted });
  y -= 12;
  const totalRow = (label, value, opts = {}) => { right(label, 470, y, opts); right(money(value), 555, y, opts); y -= 13; };
  if (inv.is_tax_invoice) {
    totalRow("Taxable value", inv.taxable_amount);
    const rate = env.INVOICE_GST_RATE;
    if (Number(inv.igst) > 0) totalRow(`IGST @ ${rate}%`, inv.igst);
    else { totalRow(`CGST @ ${rate / 2}%`, inv.cgst); totalRow(`SGST @ ${rate / 2}%`, inv.sgst); }
  }
  totalRow("Total", inv.total, { bold: true });
  y -= 4;
  text(`Amount in words: ${rupeesInWords(Number(inv.total))}`, 40, y, { color: muted });
  y -= 14;
  if (inv.notes) { text(inv.notes, 40, y, { color: muted }); y -= 12; }
  if (inv.payment_ref) { text(`Payment reference: ${inv.payment_ref}`, 40, y, { color: muted }); y -= 12; }
  if (inv.status === "CANCELLED") text(`CANCELLED${inv.cancelled_reason ? `: ${inv.cancelled_reason}` : ""}`, 40, y, { bold: true, color: rgb(0.7, 0.1, 0.1) });

  text("Prices include GST where applicable. This is a computer-generated document and needs no signature.", 40, 50, { size: 8, color: muted });
  return Buffer.from(await pdf.save());
}

/* ── helpers ── */
function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
const money = (n) => (Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ascii = (s) => String(s ?? "").replace(/₹/g, "Rs.").replace(/[–—]/g, "-").replace(/[›»]/g, ">").replace(/×/g, "x").replace(/[^\x20-\x7E]/g, "?");
function wrap(s, width) {
  const words = String(s || "").split(/\s+/);
  const out = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > width) { if (line) out.push(line); line = w; } else line = (line + " " + w).trim();
  }
  if (line) out.push(line);
  return out;
}
function fmtDate(d) {
  return ymd(toLocal(d ? new Date(d) : new Date())).split("-").reverse().join("-");
}
function localStartUtc(dateStr) {
  const { fromLocal } = require("./time.service");
  const [y, m, d] = dateStr.split("-").map(Number);
  return fromLocal(new Date(Date.UTC(y, m - 1, d)));
}
function monthsBetween(a, b) {
  const days = (Date.parse(b) - Date.parse(a)) / 86400000 + 1;
  return Math.max(1, Math.round(days / 30.4));
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
  "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function twoDigits(n) { return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`; }
function threeDigits(n) {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", r ? twoDigits(r) : ""].filter(Boolean).join(" ");
}
function indianWords(n) {
  if (n === 0) return "Zero";
  const parts = [];
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) parts.push(`${indianWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (n) parts.push(threeDigits(n));
  return parts.join(" ");
}
function rupeesInWords(amount) {
  const neg = amount < 0;
  const abs = Math.abs(round2(amount));
  const rupees = Math.floor(abs);
  const paise = Math.round((abs - rupees) * 100);
  return `${neg ? "Minus " : ""}Rupees ${indianWords(rupees)}${paise ? ` and ${twoDigits(paise)} Paise` : ""} Only`;
}

module.exports = {
  SERIES,
  formatNo,
  computeTax,
  createCustomerReceipt,
  buildDepartmentInvoice,
  saveInvoice,
  insertInvoice,
  renderInvoicePdf,
  rupeesInWords,
  httpError,
};
