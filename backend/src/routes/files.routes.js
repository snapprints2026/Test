// src/routes/files.routes.js → /api/files/...
// Signed, expiring links (no login needed — the signature is the permission).
// Mounted in app.js BEFORE express.json because the scan upload is a raw body.
//
//   GET /api/files/get?key&name&exp&sig   decrypts a stored document and streams it
//                                         (kiosks, shop computers, scan downloads)
//   PUT /api/files/scan?job&exp&sig       a device uploads the scanned PDF / image
//                                         for a SCAN order (stored encrypted)
const express = require("express");
const path = require("path");
const db = require("../database/db");
const env = require("../config/env");
const storage = require("../services/storage.service");
const { verifyParams, randomHex } = require("../services/crypto.service");
const { readDecrypted, storeEncrypted, deleteResultFile, safeName, contentDisposition } = require("../services/file.service");
const { convertToPdf } = require("../services/convert.service");
const { getPageCount } = require("../services/pdf.service");
const { logAudit } = require("../services/audit.service");
const { getIO } = require("../socket/socket");
const { MAX_FILE_SIZE } = require("../config/fileTypes");

const router = express.Router();

router.get("/get", async (req, res) => {
  if (!verifyParams("get", req.query, ["key", "name"]))
    return res.status(403).json({ error: "Link expired or invalid" });
  const key = String(req.query.key);
  if (!key || path.isAbsolute(key) || key.includes("..")) return res.status(400).json({ error: "Bad key" });
  try {
    const info = await storage.getInfo(key);
    if (!info) return res.status(410).json({ error: "File no longer available" });
    const buffer = await readDecrypted(key);
    const name = safeName(req.query.name || path.basename(key));
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", path.extname(key).toLowerCase() === ".pdf" ? "application/pdf" : "application/octet-stream");
    res.setHeader("Content-Disposition", contentDisposition(name));
    res.setHeader("Content-Length", buffer.length);
    res.end(buffer);
  } catch (err) {
    console.error("FILE GET ERROR:", err.message);
    res.status(500).json({ error: "Could not read file" });
  }
});

router.put(
  "/scan",
  express.raw({ type: () => true, limit: MAX_FILE_SIZE + 1024 }),
  async (req, res) => {
    if (!verifyParams("scan", req.query, ["job"])) return res.status(403).json({ error: "Link expired or invalid" });
    const jobId = String(req.query.job);
    try {
      const [[job]] = await db.query(
        `SELECT job_id, machine_id, job_type, status, result_path FROM print_jobs WHERE job_id=?`, [jobId]
      );
      if (!job || job.job_type !== "SCAN") return res.status(404).json({ error: "Scan order not found" });
      if (!["PAID", "PRINTING"].includes(job.status)) return res.status(409).json({ error: `Order is ${job.status}` });

      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!body.length) return res.status(400).json({ error: "Empty file" });
      const ext = sniffExt(body);
      if (!ext) return res.status(400).json({ error: "Send a PDF, JPG or PNG" });
      const pdf = await convertToPdf(body, ext);
      const pages = await getPageCount(pdf, ".pdf");

      const key = `jobs/${jobId}/scan-${randomHex(12)}.pdf`;
      await storeEncrypted(key, pdf);
      if (job.result_path) await deleteResultFile(jobId, job.result_path);
      await db.query(
        `UPDATE print_jobs SET result_path=?, result_expires_at=NOW() + INTERVAL ? MINUTE WHERE job_id=?`,
        [key, env.SCAN_RESULT_TTL_MINUTES, jobId]
      );
      await logAudit(job.machine_id, jobId, "SCAN_UPLOADED", { pages }, { type: "DEVICE", ip: req.ip });
      getIO().emit("job_status", { jobId, status: job.status, scanReady: true });
      res.json({ ok: true, pages });
    } catch (err) {
      console.error("SCAN UPLOAD ERROR:", err);
      res.status(500).json({ error: "Could not save the scan" });
    }
  }
);

function sniffExt(buf) {
  if (buf.subarray(0, 4).toString("latin1") === "%PDF") return ".pdf";
  if (buf[0] === 0xff && buf[1] === 0xd8) return ".jpg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ".png";
  return null;
}

module.exports = router;
