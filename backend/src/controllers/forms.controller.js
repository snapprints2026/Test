// src/controllers/forms.controller.js
// Admin: the government form catalogue (RTO Form 1, 1A, 29, 30 …).
//   1. POST /admin/forms                    metadata (code, titles, category …)
//   2. POST /admin/forms/:id/upload-url     signed PUT for the blank PDF
//   3. PUT  <url>                           browser → storage
//   4. POST /admin/forms/:id/complete-upload checks it's a PDF, counts pages
//   then set isActive=true. Download official blank forms from the issuing
//   department (e.g. parivahan.gov.in) — don't use edited copies.
const path = require("path");
const db = require("../database/db");
const env = require("../config/env");
const storage = require("../services/storage.service");
const { getPageCount } = require("../services/pdf.service");
const { randomHex } = require("../services/crypto.service");
const { downloadUrl } = require("../services/file.service");
const { audit } = require("../services/audit.service");
const { SEGMENTS } = require("../services/org.service");

const fail = (res, status, error) => res.status(status).json({ error });
const str = (v, max) => (v === undefined || v === null || String(v).trim() === "" ? null : String(v).trim().slice(0, max));

function fields(b) {
  const f = {};
  if (b.code !== undefined) f.code = str(b.code, 40) && String(b.code).trim().toUpperCase().replace(/\s+/g, "-").slice(0, 40);
  for (const [k, col, max] of [["title", "title", 200], ["titleHi", "title_hi", 200], ["titleMr", "title_mr", 200],
    ["description", "description", 500], ["category", "category", 80], ["sourceUrl", "source_url", 500]])
    if (b[k] !== undefined) f[col] = str(b[k], max);
  if (b.segment !== undefined) f.segment = SEGMENTS.includes(b.segment) ? b.segment : null;
  if (b.organizationId !== undefined) f.organization_id = Number(b.organizationId) || null;
  if (b.defaultCopies !== undefined) f.default_copies = Math.min(20, Math.max(1, parseInt(b.defaultCopies, 10) || 1));
  if (b.color !== undefined) f.color = b.color === "color" ? "color" : "bw";
  if (b.paperSize !== undefined) f.paper_size = b.paperSize === "A3" ? "A3" : "A4";
  if (b.printSide !== undefined) f.print_side = b.printSide === "duplex" ? "duplex" : "single";
  if (b.sortOrder !== undefined) f.sort_order = parseInt(b.sortOrder, 10) || 0;
  if (b.isActive !== undefined) f.is_active = b.isActive ? 1 : 0;
  return f;
}

/* GET /api/admin/forms */
exports.listForms = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT f.*, o.name AS organization_name,
              (SELECT COUNT(*) FROM print_jobs pj WHERE pj.form_template_id=f.id AND pj.status='PRINTED') AS times_printed
       FROM form_templates f LEFT JOIN organizations o ON o.id=f.organization_id
       ORDER BY f.category, f.sort_order, f.title`
    );
    res.json(rows.map((r) => ({ ...r, has_file: !!r.file_path, file_path: undefined })));
  } catch (err) {
    console.error("FORMS LIST ERROR:", err);
    res.status(500).json({ error: "Failed to load forms" });
  }
};

/* POST /api/admin/forms */
exports.createForm = async (req, res) => {
  try {
    const f = fields(req.body);
    if (!f.code || !f.title) return fail(res, 400, "code and title are required");
    if (f.segment === undefined) f.segment = "GOVERNMENT";
    f.is_active = 0; // activate after the PDF is uploaded
    f.created_by = req.staff.id;
    const [[dup]] = await db.query(`SELECT id FROM form_templates WHERE code=?`, [f.code]);
    if (dup) return fail(res, 409, "A form with this code already exists");
    const cols = Object.keys(f);
    const [r] = await db.query(`INSERT INTO form_templates (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, cols.map((c) => f[c]));
    await audit(req, "FORM_CREATED", { details: { id: r.insertId, code: f.code } });
    res.json({ success: true, id: r.insertId });
  } catch (err) {
    console.error("FORM CREATE ERROR:", err);
    res.status(500).json({ error: "Failed to create form" });
  }
};

/* PATCH /api/admin/forms/:formId */
exports.updateForm = async (req, res) => {
  try {
    const id = Number(req.params.formId);
    const [[form]] = await db.query(`SELECT id, file_path, page_count FROM form_templates WHERE id=?`, [id]);
    if (!form) return fail(res, 404, "Form not found");
    const f = fields(req.body);
    if (f.is_active && !(form.file_path && form.page_count > 0)) return fail(res, 400, "Upload the PDF before activating the form");
    if (f.code) {
      const [[dup]] = await db.query(`SELECT id FROM form_templates WHERE code=? AND id<>?`, [f.code, id]);
      if (dup) return fail(res, 409, "A form with this code already exists");
    }
    const cols = Object.keys(f);
    if (!cols.length) return res.json({ success: true });
    await db.query(`UPDATE form_templates SET ${cols.map((c) => `${c}=?`).join(", ")} WHERE id=?`, [...cols.map((c) => f[c]), id]);
    await audit(req, "FORM_UPDATED", { details: { id, fields: cols } });
    res.json({ success: true });
  } catch (err) {
    console.error("FORM UPDATE ERROR:", err);
    res.status(500).json({ error: "Failed to update form" });
  }
};

/* POST /api/admin/forms/:formId/upload-url → { uploadUrl, contentType } */
exports.formUploadUrl = async (req, res) => {
  try {
    if (!storage.isEnabled()) return fail(res, 503, "File storage is not configured");
    const id = Number(req.params.formId);
    const [[form]] = await db.query(`SELECT id FROM form_templates WHERE id=?`, [id]);
    if (!form) return fail(res, 404, "Form not found");
    const key = `templates/${id}/${randomHex(12)}.pdf`;
    const uploadUrl = await storage.createUploadUrl(key, "application/pdf");
    res.json({ uploadUrl, contentType: "application/pdf", key, expiresIn: env.R2_UPLOAD_URL_TTL_SECONDS });
  } catch (err) {
    console.error("FORM UPLOAD URL ERROR:", err);
    res.status(500).json({ error: "Could not start the upload" });
  }
};

/* POST /api/admin/forms/:formId/complete-upload  { key } → { pages } */
exports.completeFormUpload = async (req, res) => {
  try {
    const id = Number(req.params.formId);
    const key = String(req.body.key || "");
    if (!key.startsWith(`templates/${id}/`) || path.extname(key) !== ".pdf" || key.includes("..")) return fail(res, 400, "Bad key");
    const [[form]] = await db.query(`SELECT id, file_path FROM form_templates WHERE id=?`, [id]);
    if (!form) return fail(res, 404, "Form not found");
    const info = await storage.getInfo(key);
    if (!info) return fail(res, 400, "Upload did not finish. Try again.");
    const buf = await storage.getBuffer(key);
    if (buf.subarray(0, 4).toString("latin1") !== "%PDF") {
      await storage.remove(key).catch(() => {});
      return fail(res, 400, "That file is not a PDF");
    }
    let pages;
    try {
      pages = await getPageCount(buf, ".pdf");
    } catch {
      await storage.remove(key).catch(() => {});
      return fail(res, 400, "Could not read this PDF. Is it password-protected?");
    }
    await db.query(`UPDATE form_templates SET file_path=?, page_count=? WHERE id=?`, [key, pages, id]);
    if (form.file_path && form.file_path !== key) await storage.remove(form.file_path).catch(() => {});
    await audit(req, "FORM_FILE_UPLOADED", { details: { id, pages } });
    res.json({ success: true, pages });
  } catch (err) {
    console.error("FORM COMPLETE ERROR:", err);
    res.status(500).json({ error: "Upload failed" });
  }
};

/* GET /api/admin/forms/:formId/preview → { url } */
exports.previewForm = async (req, res) => {
  try {
    const [[form]] = await db.query(`SELECT code, file_path FROM form_templates WHERE id=?`, [req.params.formId]);
    if (!form || !form.file_path) return fail(res, 404, "No PDF uploaded yet");
    res.json({ url: downloadUrl(form.file_path, `${form.code}.pdf`, 600) });
  } catch (err) {
    console.error("FORM PREVIEW ERROR:", err);
    res.status(500).json({ error: "Could not create a preview link" });
  }
};
