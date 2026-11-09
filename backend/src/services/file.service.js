// src/services/file.service.js
// Customer documents: encrypted at rest, deleted as soon as they're printed.
//
//   - Every stored job file is AES-256-GCM encrypted (crypto.service) before
//     it is written to storage (R2 or the local folder), so a leaked bucket
//     key or a public bucket exposes nothing readable.
//   - Devices never get a direct storage link any more. They get a short-lived
//     signed link to this API (/api/files/get), which decrypts and streams the
//     PDF. Kiosk and shop agent code doesn't change: it is still a plain GET.
//   - Once printed / failed / expired, the file is deleted, the row is KEPT
//     (revenue history) with file_path = NULL and file_deleted_at set, and a
//     FILE_DELETED audit entry is written.
//
// file_path holds the storage key, e.g. "jobs/JOB_ab12.../9f3c....pdf".
// Rows from before R2 hold an absolute disk path; those files are long gone.
const path = require("path");
const db = require("../database/db");
const env = require("../config/env");
const storage = require("./storage.service");
const { encryptBuffer, decryptBuffer, signParams } = require("./crypto.service");
const { logAudit, SYSTEM } = require("./audit.service");

const isStorageKey = (p) => !!p && !path.isAbsolute(p);

async function storeEncrypted(key, buffer) {
  await storage.putBuffer(key, encryptBuffer(buffer), "application/octet-stream");
}

async function readDecrypted(key) {
  return decryptBuffer(await storage.getBuffer(key));
}

const query = (params) => new URLSearchParams(params).toString();

/* Signed link a device (or the customer, for scans) can GET without headers. */
function downloadUrl(key, fileName, ttlSeconds = env.R2_DOWNLOAD_URL_TTL_SECONDS) {
  const params = signParams("get", { key, name: safeName(fileName) }, ttlSeconds);
  return `${env.API_BASE_URL}/files/get?${query(params)}`;
}

/* Signed link a device PUTs a scanned PDF to (SCAN orders). */
function scanUploadUrl(jobId, ttlSeconds = 30 * 60) {
  const params = signParams("scan", { job: jobId }, ttlSeconds);
  return `${env.API_BASE_URL}/files/scan?${query(params)}`;
}

async function deleteJobFile(jobId, filePath, reason = "printed") {
  if (isStorageKey(filePath)) {
    try {
      await storage.remove(filePath);
    } catch (e) {
      // Keep file_path so the cleanup job retries; R2's lifecycle rule is the final safety net.
      console.error("FILE DELETE ERROR:", jobId, e.message);
      return false;
    }
  }
  try {
    const [r] = await db.query(
      `UPDATE print_jobs SET file_path=NULL, file_deleted_at=COALESCE(file_deleted_at, NOW()) WHERE job_id=?`,
      [jobId]
    );
    if (r.affectedRows && filePath) await logAudit(null, jobId, "FILE_DELETED", { reason }, SYSTEM);
  } catch (e) {
    console.error("CLEAR file_path ERROR:", e.message);
  }
  return true;
}

/* SCAN orders: the scanned PDF the customer downloads. */
async function deleteResultFile(jobId, resultPath) {
  if (isStorageKey(resultPath)) {
    try {
      await storage.remove(resultPath);
    } catch (e) {
      console.error("RESULT DELETE ERROR:", jobId, e.message);
      return false;
    }
  }
  await db.query(`UPDATE print_jobs SET result_path=NULL WHERE job_id=?`, [jobId]);
  if (resultPath) await logAudit(null, jobId, "FILE_DELETED", { reason: "scan download window over" }, SYSTEM);
  return true;
}

/* Uploads are converted to PDF; give devices a file name that matches
   ("Report.docx" stored as …/abc.pdf → "Report.pdf"). */
function printFileName(fileName, filePath) {
  const name = fileName || "document";
  if (filePath && path.extname(filePath).toLowerCase() === ".pdf" && path.extname(name).toLowerCase() !== ".pdf") {
    return name.slice(0, name.length - path.extname(name).length) + ".pdf";
  }
  return name;
}

function safeName(fileName) {
  return String(fileName || "document").replace(/["\\\r\n/]/g, "_").slice(0, 150);
}

/* Content-Disposition that works for any file name (Hindi / Marathi, dashes …). */
function contentDisposition(fileName, type = "attachment") {
  const name = safeName(fileName);
  const ascii = name.normalize("NFKD").replace(/[^\x20-\x7E]/g, "_");
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

module.exports = {
  isStorageKey,
  storeEncrypted,
  readDecrypted,
  downloadUrl,
  scanUploadUrl,
  deleteJobFile,
  deleteResultFile,
  printFileName,
  safeName,
  contentDisposition,
};
