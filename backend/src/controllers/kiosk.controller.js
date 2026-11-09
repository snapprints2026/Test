// src/controllers/kiosk.controller.js
// Module 1 — endpoints called by the Raspberry Pi kiosks (all signed with
// verifyMachine, except /register-machine which is the old first-boot bootstrap).
// New devices of both modules should register with a setup code instead
// (POST /api/devices/register, see device.controller.js).
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const db = require("../database/db");
const env = require("../config/env");
const { getIO } = require("../socket/socket");
const { logAudit } = require("../services/audit.service");
const { isStorageKey, printFileName, downloadUrl, scanUploadUrl } = require("../services/file.service");
const { hashSecret } = require("../services/crypto.service");
const storage = require("../services/storage.service");
const { markPrinted, markFailed } = require("../services/fulfilment.service");

const fileUrlFor = (jobId) => `/api/kiosk/jobs/${encodeURIComponent(jobId)}/file`;
const device = (req) => ({ type: "DEVICE", id: req.machine.id, ip: req.ip });

async function raiseAlert(machineId, type, message) {
  const [[existing]] = await db.query(
    `SELECT id FROM machine_alerts WHERE machine_id=? AND alert_type=? AND is_resolved=FALSE`, [machineId, type]
  );
  if (!existing) {
    await db.query(`INSERT INTO machine_alerts (machine_id, alert_type, message) VALUES (?, ?, ?)`, [machineId, type, message]);
  }
}
const resolveAlert = (machineId, type) =>
  db.query(
    `UPDATE machine_alerts SET is_resolved=TRUE, resolved_at=NOW() WHERE machine_id=? AND alert_type=? AND is_resolved=FALSE`,
    [machineId, type]
  );

/* POST /api/kiosk/heartbeat
   { cpu_usage, paper_level, ink_level, status,
     power_source?: "MAINS"|"UPS", ups_battery_pct?, door_open? }   (sensor fields are optional) */
exports.heartbeat = async (req, res) => {
  try {
    const machineId = req.machine.machine_id;
    const { cpu_usage, paper_level, ink_level, status } = req.body;
    const power = ["MAINS", "UPS"].includes(String(req.body.power_source || "").toUpperCase())
      ? String(req.body.power_source).toUpperCase() : null;
    const ups = Number.isFinite(Number(req.body.ups_battery_pct)) ? Math.round(Number(req.body.ups_battery_pct)) : null;
    const door = req.body.door_open === undefined || req.body.door_open === null ? null : req.body.door_open ? 1 : 0;

    await db.query(
      `INSERT INTO machine_heartbeat_logs (machine_id, cpu_usage, paper_level, ink_level, power_source, ups_battery_pct, door_open, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [machineId, cpu_usage ?? null, paper_level ?? null, ink_level ?? null, power, ups, door, status || "ONLINE"]
    );
    await db.query(`UPDATE machines SET last_seen_at=NOW(), last_ip=? WHERE machine_id=?`, [req.ip, machineId]);

    const lowThreshold = req.machine.paper_threshold || 10;
    const criticalThreshold = req.machine.critical_paper_threshold || 5;

    if (paper_level != null) {
      if (paper_level <= criticalThreshold) {
        await db.query(`UPDATE machines SET is_print_locked=TRUE WHERE machine_id=?`, [machineId]);
      } else if (req.machine.is_print_locked) {
        // Paper refilled → payments open again
        await db.query(`UPDATE machines SET is_print_locked=FALSE WHERE machine_id=?`, [machineId]);
      }
      if (paper_level <= lowThreshold) await raiseAlert(machineId, "LOW_PAPER", `Paper level is ${paper_level}%`);
      else await resolveAlert(machineId, "LOW_PAPER");
    }
    // UPS / enclosure sensors (optional hardware)
    if (power === "UPS") await raiseAlert(machineId, "ON_UPS", `Running on UPS battery${ups !== null ? ` (${ups}%)` : ""}`);
    else if (power === "MAINS") await resolveAlert(machineId, "ON_UPS");
    if (ups !== null && ups <= 20) await raiseAlert(machineId, "UPS_LOW", `UPS battery at ${ups}%`);
    else if (ups !== null) await resolveAlert(machineId, "UPS_LOW");
    if (door === 1) await raiseAlert(machineId, "DOOR_OPEN", "Enclosure door is open");
    else if (door === 0) await resolveAlert(machineId, "DOOR_OPEN");

    getIO().emit("machine_update", { machineId, paper_level, status });
    res.json({ status: "alive" });
  } catch (err) {
    console.error("HEARTBEAT ERROR:", err);
    res.status(500).json({ error: "Heartbeat failed" });
  }
};

/* POST /api/kiosk/unlock   { otp } or { qrToken }
   → { jobId, jobType, pages, copies, color, paperSize, printSide,
       downloadUrl, fileUrl, fileName      (PRINT / FORM — the PDF to print)
       scanUploadUrl                        (SCAN — PUT the scanned PDF here, then mark-printed)
       COPY: nothing to download — copy `pages` originals × `copies`, then mark-printed } */
exports.unlock = async (req, res) => {
  const connection = await db.getConnection();
  let txStarted = false;
  try {
    const { otp, qrToken } = req.body;
    const machineId = req.machine.machine_id;
    if (req.machine.module === "SHOP") return res.status(400).json({ error: "Shop machines don't use OTP unlock" });
    if (!otp && !qrToken) return res.status(400).json({ error: "OTP or QR token required" });

    await connection.beginTransaction();
    txStarted = true;
    const now = new Date();

    const [rows] = await connection.query(
      `SELECT pj.*
       FROM print_jobs pj
       INNER JOIN print_job_tokens pjt ON pj.job_id = pjt.job_id
       WHERE pj.machine_id=? AND pj.status='PAID' AND pjt.otp_verified=0
         AND (
           (pjt.otp_hash IS NOT NULL AND pjt.otp_hash=? AND pjt.otp_expires_at>?)
           OR
           (pjt.qr_hash IS NOT NULL AND pjt.qr_hash=? AND pjt.qr_expires_at>?)
         )
       ORDER BY pj.updated_at
       LIMIT 1
       FOR UPDATE`,
      [machineId, otp ? hashSecret(String(otp).trim()) : null, now, qrToken ? hashSecret(String(qrToken).trim()) : null, now]
    );

    if (!rows.length) {
      await connection.rollback();
      txStarted = false;
      await logAudit(machineId, null, "UNLOCK_FAILED", { via: otp ? "otp" : "qr" }, device(req));
      return res.status(401).json({ error: "Invalid or expired OTP / QR" });
    }

    const job = rows[0];
    await connection.query(`UPDATE print_jobs SET status='PRINTING', updated_at=NOW() WHERE id=?`, [job.id]);
    await connection.query(`UPDATE print_job_tokens SET otp_verified=1 WHERE job_id=?`, [job.job_id]);
    await connection.commit();
    txStarted = false;

    await logAudit(machineId, job.job_id, "JOB_UNLOCKED", { jobType: job.job_type }, device(req));
    getIO().emit("job_status", { jobId: job.job_id, status: "PRINTING" });

    const out = {
      jobId: job.job_id,
      jobType: job.job_type || "PRINT",
      pages: job.total_pages,
      copies: job.copies,
      color: job.color,
      paperSize: job.paper_size,
      printSide: job.print_side,
      downloadUrl: null,
      fileUrl: null,
      fileName: null,
    };
    if (isStorageKey(job.file_path)) {
      const name = printFileName(job.file_name, job.file_path);
      out.downloadUrl = downloadUrl(job.file_path, name); // plain GET, decrypted by the API, expires
      out.fileUrl = fileUrlFor(job.job_id);                // signed kiosk GET → redirects there
      out.fileName = name;
    }
    if (job.job_type === "SCAN") out.scanUploadUrl = scanUploadUrl(job.job_id);
    return res.json(out);
  } catch (err) {
    if (txStarted) await connection.rollback().catch(() => {});
    console.error("KIOSK UNLOCK ERROR:", err);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    connection.release();
  }
};

/* GET /api/kiosk/jobs/:jobId/file — checks the kiosk owns the job, then:
     default        → 302 redirect to a short-lived signed link (decrypted by the API)
     ?format=json   → { url, fileName, expiresIn } */
exports.downloadJobFile = async (req, res) => {
  try {
    const [[job]] = await db.query(
      `SELECT job_id, machine_id, file_name, file_path, status FROM print_jobs WHERE job_id=?`,
      [req.params.jobId]
    );
    if (!job || job.machine_id !== req.machine.machine_id)
      return res.status(404).json({ error: "Job not found" });
    if (!["PAID", "PRINTING"].includes(job.status))
      return res.status(409).json({ error: "Job is not ready for printing" });
    if (!isStorageKey(job.file_path))
      return res.status(410).json({ error: "File no longer available" });

    const info = await storage.getInfo(job.file_path);
    if (!info) return res.status(410).json({ error: "File no longer available" });

    const fileName = printFileName(job.file_name, job.file_path);
    const url = downloadUrl(job.file_path, fileName);
    if (req.query.format === "json") {
      return res.json({ url, fileName, expiresIn: env.R2_DOWNLOAD_URL_TTL_SECONDS });
    }
    res.redirect(302, url);
  } catch (err) {
    console.error("DOWNLOAD FILE ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

/* POST /api/kiosk/mark-printed   { jobId } */
exports.markPrinted = async (req, res) => {
  try {
    const { jobId } = req.body;
    if (!jobId) return res.status(400).json({ error: "Job ID required" });
    const r = await markPrinted(req.machine.machine_id, jobId, device(req));
    res.status(r.status).json(r.body);
  } catch (err) {
    console.error("MARK PRINTED ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

/* POST /api/kiosk/mark-failed   { jobId, reason? } — auto-refunds */
exports.markFailed = async (req, res) => {
  try {
    const { jobId } = req.body;
    const reason = req.body.reason || req.body.error || null; // the Pi app sends `error`
    if (!jobId) return res.status(400).json({ error: "Job ID required" });
    const r = await markFailed(req.machine.machine_id, jobId, reason || null, ["PRINTING"], device(req));
    res.status(r.status).json(r.body);
  } catch (err) {
    console.error("MARK FAILED ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

/* GET /api/kiosk/pending-jobs */
exports.pendingJobs = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT pj.job_id, pj.job_type, pj.total_pages AS pages, pj.copies
       FROM print_jobs pj
       INNER JOIN print_job_tokens pjt ON pj.job_id = pjt.job_id
       WHERE pj.machine_id=? AND pj.status='PAID'
         AND pjt.otp_verified=0 AND pjt.otp_expires_at > NOW()`,
      [req.machine.machine_id]
    );
    const jobs = rows.map((j) => ({ ...j, file_url: j.job_type === "COPY" || j.job_type === "SCAN" ? null : fileUrlFor(j.job_id) }));
    res.json({ jobs });
  } catch (err) {
    console.error("PENDING JOBS ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

/* POST /api/register-machine   { deviceSerial } — OLD first boot of a Pi.
   API keys are no longer stored in plain text, so every call issues a NEW key
   (the Pi saves the one it gets). Only hands out KIOSK machines. Turn it off
   with ALLOW_LEGACY_PI_REGISTRATION=false once your Pis use setup codes. */
exports.registerMachine = async (req, res) => {
  if (!env.ALLOW_LEGACY_PI_REGISTRATION)
    return res.status(410).json({ error: "Register with a setup code: POST /api/devices/register" });
  try {
    const { deviceSerial } = req.body;
    if (!deviceSerial) return res.status(400).json({ error: "Device serial required" });

    const [[existing]] = await db.query(`SELECT * FROM machines WHERE device_serial=?`, [deviceSerial]);
    const apiKey = crypto.randomBytes(32).toString("hex");
    const hash = await bcrypt.hash(apiKey, 10);

    if (existing) {
      await db.query(`UPDATE machines SET api_key_hash=?, last_seen_at=NOW() WHERE machine_id=?`, [hash, existing.machine_id]);
      await logAudit(existing.machine_id, null, "MACHINE_API_KEY_ROTATED", { via: "legacy_serial" }, { type: "DEVICE", ip: req.ip });
      console.log(`🔑 New key issued for ${existing.machine_id} (legacy registration)`);
      return res.json({ MACHINE_ID: existing.machine_id, API_KEY: apiKey, API_BASE: env.API_BASE_URL });
    }

    // Oldest free KIOSK machine first (SPK1001 before SPK1002). The UPDATE re-checks
    // assigned=FALSE so two Pis booting at the same moment can't take the same one.
    for (let attempt = 1; attempt <= 3; attempt++) {
      const [[machine]] = await db.query(
        `SELECT machine_id FROM machines WHERE assigned=FALSE AND status='PENDING' AND module='KIOSK'
         ORDER BY id LIMIT 1`
      );
      if (!machine) return res.status(400).json({ error: "No available kiosk machines. Create one from the admin panel first." });
      const [claim] = await db.query(
        `UPDATE machines SET assigned=TRUE, status='ACTIVE', device_serial=?, api_key_hash=?, last_seen_at=NOW()
         WHERE machine_id=? AND assigned=FALSE`,
        [deviceSerial, hash, machine.machine_id]
      );
      if (!claim.affectedRows) continue; // another Pi took it a moment ago — try the next one
      await logAudit(machine.machine_id, null, "MACHINE_API_KEY_ROTATED", { via: "legacy_serial", first: true }, { type: "DEVICE", ip: req.ip });
      console.log(`✅ New machine registered: ${machine.machine_id} (device ${deviceSerial})`);
      return res.json({ MACHINE_ID: machine.machine_id, API_KEY: apiKey, API_BASE: env.API_BASE_URL });
    }
    res.status(409).json({ error: "Could not claim a machine, please retry" });
  } catch (err) {
    console.error("REGISTER ERROR:", err);
    res.status(500).json({ error: "Registration failed" });
  }
};
