// src/controllers/job.controller.js
// Customer-side order endpoints. A logged-in customer only sees their own
// orders; guests use their order by its random jobId.
//
// Four kinds of order (machines.enabled_job_types decides which are offered):
//   PRINT  upload a file (PDF, Word, image, text)       POST /api/upload-url …
//   FORM   pick a blank government form, no upload      POST /api/form-jobs
//   COPY   photocopy at the machine (say how many pages) POST /api/service-jobs
//   SCAN   scan at the machine, download the PDF         POST /api/service-jobs
// Every order needs the DPDP consent tick (body.consent).
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const db = require("../database/db");
const env = require("../config/env");
const { getIO } = require("../socket/socket");
const { quoteJob } = require("../services/pricing.service");
const { getPageCount } = require("../services/pdf.service");
const { convertToPdf, randomName } = require("../services/convert.service");
const storage = require("../services/storage.service");
const machines = require("../services/machine.service");
const { deleteJobFile, storeEncrypted, downloadUrl, isStorageKey } = require("../services/file.service");
const { readConsent, recordConsent } = require("../services/consent.service");
const { markPaid } = require("../services/fulfilment.service");
const invoices = require("../services/invoice.service");
const { audit } = require("../services/audit.service");
const { jobOwnerFilter } = require("../middleware/verifyCustomerToken");
const { MAX_FILE_SIZE, EXT_TO_MIME, ALLOWED_LABEL } = require("../config/fileTypes");

const MAX_COPIES = 100;
const MAX_SERVICE_PAGES = 200;
const MAX_NAME_LENGTH = 200;

// "JOB_" + 16 random hex chars (20 chars total) — unguessable, no collisions
const newJobId = () => "JOB_" + crypto.randomBytes(8).toString("hex");

const COLORS = ["bw", "color"];
const SIDES = ["single", "duplex"];
const SIZES = ["A4", "A3"];

const parseInt1 = (value, max) => {
  const n = parseInt(value, 10);
  return Number.isInteger(n) && n >= 1 && n <= max ? n : null;
};

/* Normalise print options; returns { error } for anything unknown. */
function parseOptions(body, jobType = "PRINT") {
  const color = body.color || "bw";
  const printSide = jobType === "SCAN" ? "single" : body.printSide || "single";
  const paperSize = body.paperSize || "A4";
  const copies = jobType === "SCAN" ? 1 : parseInt1(body.copies ?? 1, MAX_COPIES);
  if (!COLORS.includes(color)) return { error: "Unknown print type" };
  if (!SIDES.includes(printSide)) return { error: "Unknown print side" };
  if (!SIZES.includes(paperSize)) return { error: "Unknown paper size" };
  if (!copies) return { error: `Copies must be between 1 and ${MAX_COPIES}` };
  const out = { color, printSide, paperSize, copies };
  if (jobType === "COPY" || jobType === "SCAN") {
    const pages = parseInt1(body.pages ?? 1, MAX_SERVICE_PAGES);
    if (!pages) return { error: `Pages must be between 1 and ${MAX_SERVICE_PAGES}` };
    out.pages = pages;
  }
  return out;
}

/* Shop machines only offer what their printers can do (printing / copying). */
async function checkShopOptions(machine, opts, jobType = "PRINT") {
  if (machine.module !== "SHOP" || jobType === "SCAN") return null;
  const ok = await machines.shopCanPrint(machine.machine_id, opts);
  if (ok) return null;
  if (opts.color === "color" && !(await machines.shopCanPrint(machine.machine_id, { color: "color" })))
    return "This shop has no colour printer. Please choose B & W.";
  return "This shop's printers can't print with these options. Please change paper size or print side.";
}

/* Machine + checks shared by every way of creating an order. */
async function loadMachineFor(req, res, jobType) {
  const { machineId } = req.body;
  if (!machineId) { res.status(400).json({ error: "machineId is required" }); return null; }
  const ctx = await machines.getContext(machineId);
  if (!ctx || ctx.status !== "ACTIVE") { res.status(404).json({ error: "Machine not found" }); return null; }
  if (!ctx.jobTypes.includes(jobType)) { res.status(400).json({ error: "This machine doesn't offer that service" }); return null; }
  if (machines.loginRequired(ctx) && !req.customer) { res.status(401).json({ error: "Please log in to continue" }); return null; }
  return ctx;
}

function requireConsent(req, res) {
  const consent = readConsent(req.body);
  if (!consent && env.CONSENT_REQUIRED) {
    res.status(400).json({ error: "Please accept the privacy notice to continue", code: "CONSENT_REQUIRED" });
    return undefined;
  }
  return consent;
}

/* Columns every new order gets from its machine. */
const stamp = (ctx) => ({
  organization_id: ctx.organization_id || null,
  contract_id: ctx.activeContractId || null,
  billing: ctx.billing_mode === "DEPARTMENT" ? "DEPARTMENT" : "CUSTOMER",
});

/* ─────────────────────────────────────────────────────────────────────────
   PRINT: upload = 3 steps, the file goes straight from the phone to storage:
     1. POST /api/upload-url                 → job row + signed PUT URL
     2. PUT  <uploadUrl>  (browser → R2)       file bytes, Content-Type header
     3. POST /api/jobs/:jobId/complete-upload → convert to PDF, encrypt, count pages
   ───────────────────────────────────────────────────────────────────────── */

/* POST /api/upload-url
   { fileName, fileSize, machineId, color, copies, paperSize, printSide, consent }
   → { jobId, uploadUrl, contentType, expiresIn } */
exports.createUploadUrl = async (req, res) => {
  try {
    if (!storage.isEnabled()) return res.status(503).json({ error: "Uploads are temporarily unavailable" });

    const { fileName } = req.body;
    const fileSize = Number(req.body.fileSize);
    const opts = parseOptions(req.body);

    if (!fileName || typeof fileName !== "string") return res.status(400).json({ error: "fileName is required" });
    if (opts.error) return res.status(400).json({ error: opts.error });
    if (!Number.isFinite(fileSize) || fileSize <= 0) return res.status(400).json({ error: "File is empty" });
    if (fileSize > MAX_FILE_SIZE) return res.status(413).json({ error: "File is larger than 50 MB" });

    const ext = path.extname(fileName).toLowerCase();
    const contentType = EXT_TO_MIME[ext];
    if (!contentType) return res.status(400).json({ error: `Unsupported file type. Allowed: ${ALLOWED_LABEL}` });

    const consent = requireConsent(req, res);
    if (consent === undefined) return;
    const ctx = await loadMachineFor(req, res, "PRINT");
    if (!ctx) return;
    const shopProblem = await checkShopOptions(ctx, opts);
    if (shopProblem) return res.status(400).json({ error: shopProblem });

    const jobId = newJobId();
    // Random object name; strict-privacy machines (government) don't keep the
    // customer's file name at all — names often contain a person's name or ID number.
    const key = `jobs/${jobId}/${crypto.randomBytes(16).toString("hex")}${ext}`;
    const originalName = ctx.strictPrivacy ? `document${ext}` : path.basename(fileName).slice(0, MAX_NAME_LENGTH);
    const s = stamp(ctx);

    await db.query(
      `INSERT INTO print_jobs (job_id, machine_id, customer_id, organization_id, contract_id, billing, job_type, source,
         file_name, file_path, color, copies, paper_size, print_side, total_pages, status)
       VALUES (?, ?, ?, ?, ?, ?, 'PRINT', ?, ?, ?, ?, ?, ?, ?, 0, 'CREATED')`,
      [jobId, ctx.machine_id, req.customer ? req.customer.customerId : null, s.organization_id, s.contract_id, s.billing,
       req.body.source === "CARD" ? "CARD" : "UPLOAD", // CARD = photo of card, laid out on the phone
       originalName, key, opts.color, opts.copies, opts.paperSize, opts.printSide]
    );
    await recordConsent({ customerId: req.customer?.customerId, jobId, machineId: ctx.machine_id, consent, ip: req.ip });

    const uploadUrl = await storage.createUploadUrl(key, contentType);
    res.json({ jobId, uploadUrl, contentType, expiresIn: env.R2_UPLOAD_URL_TTL_SECONDS });
  } catch (err) {
    console.error("UPLOAD URL ERROR:", err);
    res.status(500).json({ error: "Could not start the upload" });
  }
};

/* POST /api/jobs/:jobId/complete-upload   → { jobId, pages } */
exports.completeUpload = async (req, res) => {
  const { jobId } = req.params;
  try {
    const owner = jobOwnerFilter(req);
    const [[job]] = await db.query(
      `SELECT job_id, machine_id, file_name, file_path, file_encrypted, total_pages, status
       FROM print_jobs WHERE job_id=? AND ${owner.sql}`,
      [jobId, ...owner.params]
    );
    if (!job) return res.status(404).json({ error: "Job not found" });
    if (job.status !== "CREATED" || !job.file_path) return res.status(409).json({ error: "Invalid job state" });
    // Already completed (e.g. the phone retried) → same answer again
    if (job.total_pages > 0) return res.json({ jobId, pages: job.total_pages });

    const info = await storage.getInfo(job.file_path);
    if (!info) return res.status(400).json({ error: "Upload did not finish. Please try again." });

    const reject = async (status, error) => {
      await deleteJobFile(jobId, job.file_path, "rejected upload");
      await db.query(`DELETE FROM print_jobs WHERE job_id=? AND status='CREATED'`, [jobId]);
      return res.status(status).json({ error });
    };
    if (info.size > MAX_FILE_SIZE) return reject(413, "File is larger than 50 MB");

    // Convert to PDF (Word / text / images) so pages are counted correctly and
    // every device only prints PDFs. Then store it ENCRYPTED and delete the
    // plain upload — the plain file exists only for these few seconds.
    const ext = path.extname(job.file_path).toLowerCase();
    let totalPages;
    try {
      const original = await storage.getBuffer(job.file_path);
      const pdf = await convertToPdf(original, ext);
      let finalBytes = pdf;
      let finalExt = ".pdf";
      if (pdf) {
        totalPages = await getPageCount(pdf, ".pdf");
      } else {
        // Could not convert here (Word file and no LibreOffice on the server).
        const [[m]] = await db.query(`SELECT module FROM machines WHERE machine_id=?`, [job.machine_id]);
        if (m && m.module === "SHOP") return reject(400, "Word files can't be printed here right now. Please upload a PDF.");
        totalPages = await getPageCount(null, ext); // old behaviour: priced as 1 page
        finalBytes = original;
        finalExt = ext;
      }
      const newKey = `jobs/${jobId}/${randomName()}${finalExt}`;
      await storeEncrypted(newKey, finalBytes);
      await storage.remove(job.file_path).catch(() => {});
      await db.query(`UPDATE print_jobs SET file_path=?, file_encrypted=1 WHERE job_id=?`, [newKey, jobId]);
      job.file_path = newKey;
    } catch (e) {
      console.error("CONVERT/COUNT ERROR:", jobId, e.message);
      return reject(400, ext === ".pdf"
        ? "Could not read this PDF. Is it damaged or password-protected?"
        : "Could not read this file. Is it damaged? Try saving it as PDF.");
    }
    if (!totalPages || totalPages < 1) totalPages = 1;

    await db.query(
      `UPDATE print_jobs SET total_pages=?, updated_at=NOW() WHERE job_id=? AND status='CREATED'`,
      [totalPages, jobId]
    );

    getIO().emit("job_created", { jobId, machineId: job.machine_id, pages: totalPages });
    res.json({ jobId, pages: totalPages });
  } catch (err) {
    console.error("COMPLETE UPLOAD ERROR:", err);
    res.status(500).json({ error: "Upload failed" });
  }
};

/* ── FORM: blank government form from the catalogue ──
   POST /api/form-jobs  { machineId, formTemplateId, copies, color?, consent } → { jobId, pages } */
exports.createFormJob = async (req, res) => {
  try {
    if (!storage.isEnabled()) return res.status(503).json({ error: "Printing is temporarily unavailable" });
    const consent = requireConsent(req, res);
    if (consent === undefined) return;
    const ctx = await loadMachineFor(req, res, "FORM");
    if (!ctx) return;

    const formId = Number(req.body.formTemplateId);
    const forms = await availableForms(ctx);
    const form = forms.find((f) => f.id === formId);
    if (!form) return res.status(404).json({ error: "This form is not available on this machine" });

    const opts = parseOptions({
      color: req.body.color || form.color,
      copies: req.body.copies ?? form.default_copies,
      paperSize: form.paper_size,
      printSide: req.body.printSide || form.print_side,
    });
    if (opts.error) return res.status(400).json({ error: opts.error });
    const shopProblem = await checkShopOptions(ctx, opts);
    if (shopProblem) return res.status(400).json({ error: shopProblem });

    // Each order gets its own encrypted copy, so printing and deleting work
    // exactly like an uploaded file (the template itself is never touched).
    const [[tpl]] = await db.query(`SELECT file_path FROM form_templates WHERE id=?`, [formId]);
    const bytes = await storage.getBuffer(tpl.file_path);
    const jobId = newJobId();
    const key = `jobs/${jobId}/${randomName()}.pdf`;
    await storeEncrypted(key, bytes);
    const s = stamp(ctx);

    await db.query(
      `INSERT INTO print_jobs (job_id, machine_id, customer_id, organization_id, contract_id, billing, job_type,
         form_template_id, file_name, file_path, file_encrypted, color, copies, paper_size, print_side, total_pages, status)
       VALUES (?, ?, ?, ?, ?, ?, 'FORM', ?, ?, ?, 1, ?, ?, ?, ?, ?, 'CREATED')`,
      [jobId, ctx.machine_id, req.customer ? req.customer.customerId : null, s.organization_id, s.contract_id, s.billing,
       form.id, `${form.code} - ${form.title}`.slice(0, MAX_NAME_LENGTH) + ".pdf", key,
       opts.color, opts.copies, opts.paperSize, opts.printSide, Math.max(1, form.page_count)]
    );
    await recordConsent({ customerId: req.customer?.customerId, jobId, machineId: ctx.machine_id, consent, ip: req.ip });
    getIO().emit("job_created", { jobId, machineId: ctx.machine_id, pages: form.page_count });
    res.json({ jobId, pages: Math.max(1, form.page_count), form: { id: form.id, code: form.code, title: form.title } });
  } catch (err) {
    console.error("FORM JOB ERROR:", err);
    res.status(500).json({ error: "Could not create the order" });
  }
};

/* ── COPY / SCAN: done at the machine, nothing uploaded ──
   POST /api/service-jobs { machineId, jobType, pages, copies, color, printSide, paperSize, consent } */
exports.createServiceJob = async (req, res) => {
  try {
    const jobType = String(req.body.jobType || "").toUpperCase();
    if (!["COPY", "SCAN"].includes(jobType)) return res.status(400).json({ error: "jobType must be COPY or SCAN" });
    const opts = parseOptions(req.body, jobType);
    if (opts.error) return res.status(400).json({ error: opts.error });
    const consent = requireConsent(req, res);
    if (consent === undefined) return;
    const ctx = await loadMachineFor(req, res, jobType);
    if (!ctx) return;
    const shopProblem = await checkShopOptions(ctx, opts, jobType);
    if (shopProblem) return res.status(400).json({ error: shopProblem });

    const jobId = newJobId();
    const s = stamp(ctx);
    await db.query(
      `INSERT INTO print_jobs (job_id, machine_id, customer_id, organization_id, contract_id, billing, job_type,
         file_name, color, copies, paper_size, print_side, total_pages, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CREATED')`,
      [jobId, ctx.machine_id, req.customer ? req.customer.customerId : null, s.organization_id, s.contract_id, s.billing,
       jobType, jobType === "COPY" ? "Photocopy" : "Scan", opts.color, opts.copies, opts.paperSize, opts.printSide, opts.pages]
    );
    await recordConsent({ customerId: req.customer?.customerId, jobId, machineId: ctx.machine_id, consent, ip: req.ip });
    res.json({ jobId, pages: opts.pages });
  } catch (err) {
    console.error("SERVICE JOB ERROR:", err);
    res.status(500).json({ error: "Could not create the order" });
  }
};

/* Forms this machine may offer (its organisation and everything above it,
   plus forms for its segment / everyone). */
async function availableForms(ctx) {
  if (!ctx.jobTypes.includes("FORM")) return [];
  const { ancestorIds } = require("../services/org.service");
  const orgIds = await ancestorIds(ctx.organization_id);
  const [rows] = await db.query(
    `SELECT id, code, title, title_hi, title_mr, description, category, page_count, default_copies,
            color, paper_size, print_side, source_url, sort_order
     FROM form_templates
     WHERE is_active=1 AND file_path IS NOT NULL AND page_count > 0
       AND (${orgIds.length ? "organization_id IN (?) OR" : ""}
            (organization_id IS NULL AND (segment IS NULL OR segment=?)))
     ORDER BY category, sort_order, title`,
    orgIds.length ? [orgIds, ctx.segment] : [ctx.segment]
  );
  return rows;
}
exports.availableForms = availableForms;

/* GET /api/job-summary/:jobId */
exports.getSummary = async (req, res) => {
  try {
    const owner = jobOwnerFilter(req);
    const [[job]] = await db.query(
      `SELECT pj.*, ft.title AS form_title, ft.code AS form_code
       FROM print_jobs pj LEFT JOIN form_templates ft ON ft.id = pj.form_template_id
       WHERE pj.job_id=? AND ${owner.sql.replace("customer_id", "pj.customer_id")}`,
      [req.params.jobId, ...owner.params]
    );
    if (!job) return res.status(404).json({ error: "Job not found" });

    const ctx = await machines.getContext(job.machine_id);
    const price = await quoteJob(job, ctx);
    res.json({
      jobType: job.job_type,
      formTitle: job.form_title || null,
      formCode: job.form_code || null,
      billing: job.billing,
      pages: job.total_pages, totalPages: job.total_pages, copies: job.copies,
      printSide: job.print_side, color: job.color, paperSize: job.paper_size,
      units: price.units, rate: price.rate, totalAmount: price.total,
    });
  } catch (err) {
    console.error("JOB SUMMARY ERROR:", err);
    res.status(500).json({ error: "Internal error" });
  }
};

/* PATCH /api/job/:jobId   { color, copies, paperSize, printSide, pages? } */
exports.updateJob = async (req, res) => {
  try {
    const owner = jobOwnerFilter(req);
    const [[job]] = await db.query(
      `SELECT machine_id, job_type FROM print_jobs WHERE job_id=? AND ${owner.sql}`, [req.params.jobId, ...owner.params]
    );
    if (!job) return res.status(404).json({ error: "Job not found" });
    const opts = parseOptions(req.body, job.job_type);
    if (opts.error) return res.status(400).json({ error: opts.error });
    const machine = await machines.getMachine(job.machine_id);
    const shopProblem = machine ? await checkShopOptions(machine, opts, job.job_type) : null;
    if (shopProblem) return res.status(400).json({ error: shopProblem });

    const pagesSql = opts.pages ? ", total_pages=?" : "";
    const [r] = await db.query(
      `UPDATE print_jobs SET color=?, copies=?, paper_size=?, print_side=?${pagesSql},
       amount=NULL, payment_order_id=NULL, status='CREATED'
       WHERE job_id=? AND ${owner.sql} AND status IN ('CREATED','PAYING')`,
      [opts.color, opts.copies, opts.paperSize, opts.printSide, ...(opts.pages ? [opts.pages] : []),
       req.params.jobId, ...owner.params]
    );
    if (!r.affectedRows) return res.status(409).json({ error: "Job locked" });
    res.json({ success: true });
  } catch (err) {
    console.error("UPDATE JOB ERROR:", err);
    res.status(500).json({ error: "Internal error" });
  }
};

/* GET /api/job-status/:jobId
   → { status, module, jobType, orderCode?, printerName?, failReason?, scanReady?, receiptAvailable? } */
exports.getStatus = async (req, res) => {
  try {
    const owner = jobOwnerFilter(req);
    const [[job]] = await db.query(
      `SELECT pj.status, pj.job_type, pj.billing, pj.order_code, pj.fail_reason, pj.amount, pj.result_path,
              pj.result_expires_at, m.module, p.display_name AS printer_name,
              pj.ref_code, pj.refund_status, pj.refund_amount,
              (SELECT ji.status FROM job_issues ji WHERE ji.job_id = pj.job_id) AS issue_status,
              (SELECT COUNT(*) FROM print_jobs q
                WHERE q.machine_id = pj.machine_id AND q.status='PAID' AND q.updated_at < pj.updated_at) AS queue_ahead,
              (SELECT COUNT(*) FROM invoices i WHERE i.job_id = pj.job_id AND i.status <> 'CANCELLED') AS receipts
       FROM print_jobs pj
       LEFT JOIN machines m ON m.machine_id = pj.machine_id
       LEFT JOIN printers p ON p.id = pj.printer_id
       WHERE pj.job_id=? AND ${owner.sql.replace("customer_id", "pj.customer_id")}`,
      [req.params.jobId, ...owner.params]
    );
    if (!job) return res.status(404).json({ error: "Job not found" });
    const out = {
      status: job.status, module: job.module || "KIOSK", jobType: job.job_type, billing: job.billing,
      refCode: job.ref_code || null,
      refundStatus: job.refund_status || null,   // null | PROCESSING | PENDING | PROCESSED | FAILED
      refundAmount: job.refund_amount,
      issueStatus: job.issue_status || null,     // null | OPEN | APPROVED | REJECTED | AUTO_APPROVED
    };
    if (out.module === "SHOP") {
      out.orderCode = job.order_code;
      out.printerName = job.printer_name || null;
      if (job.status === "PAID") out.queueAhead = Number(job.queue_ahead) || 0;
    }
    if (job.job_type === "SCAN") {
      out.scanReady = !!job.result_path && new Date(job.result_expires_at) > new Date();
      if (out.scanReady) out.scanExpiresAt = job.result_expires_at;
    }
    if (job.status === "PRINTED" && job.billing === "CUSTOMER" && Number(job.amount) > 0)
      out.receiptAvailable = true;
    if (job.status === "FAILED" && job.fail_reason) out.failReason = job.fail_reason;
    res.json(out);
  } catch (err) {
    console.error("JOB STATUS ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

/* GET /api/jobs/:jobId/scan → { url, expiresAt } — SCAN orders */
exports.getScanLink = async (req, res) => {
  try {
    const owner = jobOwnerFilter(req);
    const [[job]] = await db.query(
      `SELECT job_id, job_type, result_path, result_expires_at FROM print_jobs WHERE job_id=? AND ${owner.sql}`,
      [req.params.jobId, ...owner.params]
    );
    if (!job || job.job_type !== "SCAN") return res.status(404).json({ error: "Scan not found" });
    if (!isStorageKey(job.result_path) || new Date(job.result_expires_at) <= new Date())
      return res.status(410).json({ error: "The scan is not ready yet, or its download time is over" });
    const secondsLeft = Math.max(60, Math.floor((new Date(job.result_expires_at) - Date.now()) / 1000));
    res.json({ url: downloadUrl(job.result_path, `scan-${job.job_id.slice(-6)}.pdf`, Math.min(secondsLeft, 900)), expiresAt: job.result_expires_at });
  } catch (err) {
    console.error("SCAN LINK ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

/* GET /api/jobs/:jobId/receipt → PDF (GST receipt for a paid order) */
exports.getReceipt = async (req, res) => {
  try {
    const owner = jobOwnerFilter(req);
    const [[job]] = await db.query(
      `SELECT job_id, status FROM print_jobs WHERE job_id=? AND ${owner.sql}`, [req.params.jobId, ...owner.params]
    );
    if (!job) return res.status(404).json({ error: "Order not found" });
    let [[inv]] = await db.query(`SELECT * FROM invoices WHERE job_id=?`, [job.job_id]);
    if (!inv && job.status === "PRINTED") {
      await invoices.createCustomerReceipt(job.job_id);
      [[inv]] = await db.query(`SELECT * FROM invoices WHERE job_id=?`, [job.job_id]);
    }
    if (!inv) return res.status(404).json({ error: "No receipt for this order" });
    const pdf = await invoices.renderInvoicePdf(inv);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="receipt-${inv.invoice_no.replace(/\//g, "-")}.pdf"`);
    res.end(pdf);
  } catch (err) {
    console.error("RECEIPT ERROR:", err);
    res.status(500).json({ error: "Could not create the receipt" });
  }
};

/* POST /api/jobs/:jobId/submit-billed   { staffPin }
   Machines billed to the department (PAY_PER_USE): staff enter the staff code
   instead of paying. The order is recorded at the approved rate and goes on
   the department's monthly invoice. */
exports.submitBilled = async (req, res) => {
  try {
    const owner = jobOwnerFilter(req);
    const [[job]] = await db.query(
      `SELECT * FROM print_jobs WHERE job_id=? AND ${owner.sql} AND status IN ('CREATED','PAYING')`,
      [req.params.jobId, ...owner.params]
    );
    if (!job) return res.status(409).json({ error: "Invalid job state" });
    if (job.total_pages < 1 || (["PRINT", "FORM"].includes(job.job_type) && !job.file_path))
      return res.status(409).json({ error: "Upload not finished yet" });

    const ctx = await machines.getContext(job.machine_id);
    if (!ctx || ctx.status !== "ACTIVE") return res.status(404).json({ error: "Machine not found" });
    if (ctx.billing_mode !== "DEPARTMENT") return res.status(400).json({ error: "This machine takes online payment" });
    if (!ctx.staff_pin_hash) return res.status(503).json({ error: "Staff code not set up for this machine. Ask the administrator." });
    const pin = String(req.body?.staffPin || "").trim();
    if (!pin || !(await bcrypt.compare(pin, ctx.staff_pin_hash))) {
      await audit(req, "STAFF_PIN_FAILED", { machineId: ctx.machine_id, jobId: job.job_id });
      return res.status(401).json({ error: "Wrong staff code" });
    }
    if (ctx.is_print_locked) return res.status(400).json({ error: "Machine out of paper." });

    const price = await quoteJob(job, ctx);
    const orderId = `dept_${crypto.randomBytes(8).toString("hex")}`;
    await db.query(
      `UPDATE print_jobs SET billing='DEPARTMENT', amount=?, unit_rate=?, pricing_rule_id=?, payment_order_id=?, status='PAYING'
       WHERE id=?`,
      [price.total, price.rate, price.ruleId, orderId, job.id]
    );
    const result = await markPaid({ orderId, paymentId: orderId, method: "department", source: "staff_code" });
    res.status(result.status).json(result.body);
  } catch (err) {
    console.error("SUBMIT BILLED ERROR:", err);
    res.status(500).json({ error: "Could not submit the order" });
  }
};
