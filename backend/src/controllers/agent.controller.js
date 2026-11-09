// src/controllers/agent.controller.js
// Module 2 — endpoints called by the SnapPrints Print Agent on a shop computer.
// Every request is signed exactly like the kiosk's (verifyMachine) and the
// machine must be a SHOP machine (requireModule("SHOP")).
//
//   POST /api/agent/heartbeat          { printers:[{systemName, status, message}] }  every 30 s
//   POST /api/agent/printers           { printers:[{systemName, displayName, kind, duplex, paperSizes}] }
//   GET  /api/agent/jobs/pending       paid jobs waiting for a printer
//   POST /api/agent/jobs/:jobId/claim  PAID → PRINTING (exactly once) + download link + printer
//   POST /api/agent/jobs/:jobId/printed
//   POST /api/agent/jobs/:jobId/failed { reason }   → automatic refund
//   GET  /api/agent/jobs/recent        today's jobs, for the shopkeeper's screen
//   PATCH /api/agent/printers/:id      { isEnabled } — pause / resume from the shop screen
//
// COPY and SCAN orders are done by the shopkeeper at the counter (agent 1.1+):
//   POST /api/agent/jobs/:jobId/start     PAID → PRINTING ("I'm doing it")
//   POST /api/agent/jobs/:jobId/scan-url  signed link to upload the scanned PDF
//   then /printed as usual. Older agents can't claim them (409 MANUAL_JOB).
const db = require("../database/db");
const env = require("../config/env");
const { getIO } = require("../socket/socket");
const machines = require("../services/machine.service");
const { isStorageKey, printFileName, downloadUrl, scanUploadUrl } = require("../services/file.service");
const { logAudit } = require("../services/audit.service");
const { markPrinted, markFailed } = require("../services/fulfilment.service");

const device = (req) => ({ type: "DEVICE", id: req.machine.id, ip: req.ip });
const PRINTER_STATUSES = ["ONLINE", "OFFLINE", "ERROR"];
const SIZES = ["A4", "A3"];

const clean = (v, max) => String(v ?? "").trim().slice(0, max);

/* POST /api/agent/heartbeat */
exports.heartbeat = async (req, res) => {
  try {
    const machineId = req.machine.machine_id;
    await db.query(`UPDATE machines SET last_seen_at=NOW(), last_ip=? WHERE machine_id=?`, [req.ip, machineId]);
    await db.query(
      `INSERT INTO machine_heartbeat_logs (machine_id, cpu_usage, status) VALUES (?, ?, 'ONLINE')`,
      [machineId, req.body?.cpu_usage ?? null]
    );

    const reported = Array.isArray(req.body?.printers) ? req.body.printers : [];
    for (const p of reported) {
      const status = PRINTER_STATUSES.includes(p.status) ? p.status : "ONLINE";
      await db.query(
        `UPDATE printers SET status=?, status_message=?, last_seen_at=NOW()
         WHERE machine_id=? AND system_name=?`,
        [status, p.message ? clean(p.message, 255) : null, machineId, clean(p.systemName, 255)]
      );
    }

    getIO().emit("machine_update", { machineId, status: "ONLINE" });
    const printers = await machines.listPrinters(machineId);
    res.json({
      status: "alive",
      printers: printers.map((p) => ({ id: p.id, systemName: p.system_name, isEnabled: p.is_enabled })),
    });
  } catch (err) {
    console.error("AGENT HEARTBEAT ERROR:", err);
    res.status(500).json({ error: "Heartbeat failed" });
  }
};

/* POST /api/agent/printers — the agent's printer list (from its setup) replaces
   what we know. Printers no longer in the list are removed. The shop/admin
   "paused" switch (is_enabled) is kept for printers that stay. */
exports.syncPrinters = async (req, res) => {
  try {
    const machineId = req.machine.machine_id;
    const list = Array.isArray(req.body?.printers) ? req.body.printers : null;
    if (!list || !list.length) return res.status(400).json({ error: "printers list required" });
    if (list.length > 20) return res.status(400).json({ error: "Too many printers" });

    const names = [];
    for (const p of list) {
      const systemName = clean(p.systemName, 255);
      if (!systemName) return res.status(400).json({ error: "Every printer needs systemName" });
      const kind = p.kind === "COLOR" ? "COLOR" : "BW";
      const sizes = (Array.isArray(p.paperSizes) ? p.paperSizes : ["A4"]).filter((s) => SIZES.includes(s));
      names.push(systemName);
      await db.query(
        `INSERT INTO printers (machine_id, system_name, display_name, kind, supports_duplex, paper_sizes, status, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, 'ONLINE', NOW())
         ON DUPLICATE KEY UPDATE display_name=VALUES(display_name), kind=VALUES(kind),
           supports_duplex=VALUES(supports_duplex), paper_sizes=VALUES(paper_sizes)`,
        [machineId, systemName, clean(p.displayName, 120) || systemName, kind, p.duplex ? 1 : 0,
         (sizes.length ? sizes : ["A4"]).join(",")]
      );
    }
    await db.query(
      `DELETE FROM printers WHERE machine_id=? AND system_name NOT IN (?)`, [machineId, names]
    );
    const printers = await machines.listPrinters(machineId);
    res.json({ success: true, printers });
  } catch (err) {
    console.error("AGENT PRINTERS ERROR:", err);
    res.status(500).json({ error: "Could not save printers" });
  }
};

/* PATCH /api/agent/printers/:printerId   { isEnabled } */
exports.setPrinterEnabled = async (req, res) => {
  try {
    const [r] = await db.query(
      `UPDATE printers SET is_enabled=? WHERE id=? AND machine_id=?`,
      [req.body?.isEnabled ? 1 : 0, req.params.printerId, req.machine.machine_id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Printer not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("AGENT PRINTER TOGGLE ERROR:", err);
    res.status(500).json({ error: "Could not update printer" });
  }
};

/* GET /api/agent/jobs/pending — oldest first */
exports.pendingJobs = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT job_id, job_type, order_code, color, copies, paper_size, print_side, total_pages, updated_at AS paid_at
       FROM print_jobs WHERE machine_id=? AND status='PAID' ORDER BY updated_at, id LIMIT 50`,
      [req.machine.machine_id]
    );
    res.json({ jobs: rows });
  } catch (err) {
    console.error("AGENT PENDING ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

/* POST /api/agent/jobs/:jobId/claim
   Picks the printer and moves the job PAID → PRINTING in one transaction, so a
   job can never be printed twice (even with two agents or a retry).
   409 { code: "NO_PRINTER" } → nothing can print it right now; it stays in the queue. */
exports.claimJob = async (req, res) => {
  const machineId = req.machine.machine_id;
  const { jobId } = req.params;
  const conn = await db.getConnection();
  let tx = false;
  try {
    await conn.beginTransaction();
    tx = true;
    const [[job]] = await conn.query(
      `SELECT * FROM print_jobs WHERE job_id=? AND machine_id=? FOR UPDATE`, [jobId, machineId]
    );
    if (!job) {
      await conn.rollback(); tx = false;
      return res.status(404).json({ error: "Job not found" });
    }
    if (job.status !== "PAID") {
      await conn.rollback(); tx = false;
      return res.status(409).json({ error: `Job is ${job.status}`, code: "NOT_PAID" });
    }
    if (machines.MANUAL_JOB_TYPES.has(job.job_type)) {
      await conn.rollback(); tx = false;
      return res.status(409).json({ error: "Photocopy / scan orders are done at the counter", code: "MANUAL_JOB" });
    }
    if (!isStorageKey(job.file_path)) {
      await conn.rollback(); tx = false;
      // File is gone — can't ever print it. Refund.
      const r = await markFailed(machineId, jobId, "File missing", ["PAID"]);
      return res.status(410).json({ error: "File no longer available — refunded", refunded: r.status === 200 });
    }

    const printer = await machines.choosePrinter(machineId, job, conn);
    if (!printer) {
      await conn.rollback(); tx = false;
      return res.status(409).json({ error: "No printer available for this job", code: "NO_PRINTER" });
    }

    await conn.query(
      `UPDATE print_jobs SET status='PRINTING', printer_id=?, updated_at=NOW() WHERE id=?`,
      [printer.id, job.id]
    );
    await conn.commit();
    tx = false;

    await logAudit(machineId, jobId, "JOB_PRINTING", { printer: printer.system_name });
    getIO().emit("job_status", { jobId, status: "PRINTING" });

    const fileName = printFileName(job.file_name, job.file_path);
    res.json({
      jobId,
      jobType: job.job_type,
      orderCode: job.order_code,
      fileName,
      downloadUrl: downloadUrl(job.file_path, fileName), // decrypted by the API, expires
      downloadExpiresIn: env.R2_DOWNLOAD_URL_TTL_SECONDS,
      copies: job.copies,
      color: job.color,
      paperSize: job.paper_size,
      printSide: job.print_side,
      totalPages: job.total_pages,
      printer: { id: printer.id, systemName: printer.system_name, displayName: printer.display_name, kind: printer.kind },
    });
  } catch (err) {
    if (tx) await conn.rollback().catch(() => {});
    console.error("AGENT CLAIM ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    conn.release();
  }
};

/* POST /api/agent/jobs/:jobId/printed */
exports.jobPrinted = async (req, res) => {
  try {
    const r = await markPrinted(req.machine.machine_id, req.params.jobId, device(req));
    res.status(r.status).json(r.body);
  } catch (err) {
    console.error("AGENT PRINTED ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

/* POST /api/agent/jobs/:jobId/failed   { reason } — refunds automatically.
   Works for PRINTING jobs and for PAID ones the shopkeeper cancels. */
exports.jobFailed = async (req, res) => {
  try {
    const reason = req.body?.reason ? clean(req.body.reason, 255) : "Printer error";
    const r = await markFailed(req.machine.machine_id, req.params.jobId, reason, ["PRINTING", "PAID"], device(req));
    res.status(r.status).json(r.body);
  } catch (err) {
    console.error("AGENT FAILED ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

/* POST /api/agent/jobs/:jobId/requeue — a PRINTING job goes back to the queue
   (e.g. the shopkeeper wants it printed again after clearing a jam). */
exports.requeueJob = async (req, res) => {
  try {
    const [r] = await db.query(
      `UPDATE print_jobs SET status='PAID', printer_id=NULL, updated_at=NOW()
       WHERE job_id=? AND machine_id=? AND status='PRINTING'
         AND (file_path IS NOT NULL OR job_type IN ('COPY','SCAN'))`,
      [req.params.jobId, req.machine.machine_id]
    );
    if (!r.affectedRows) return res.status(409).json({ error: "Only jobs that are printing can be sent again" });
    getIO().to(`machine:${req.machine.machine_id}`).emit("job_ready", { jobId: req.params.jobId });
    getIO().emit("job_status", { jobId: req.params.jobId, status: "PAID" });
    res.json({ success: true });
  } catch (err) {
    console.error("AGENT REQUEUE ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

/* GET /api/agent/jobs/recent — today's paid orders for the shop screen */
exports.recentJobs = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT pj.job_id, pj.job_type, pj.order_code, pj.file_name, pj.color, pj.copies, pj.paper_size, pj.print_side,
              pj.total_pages, pj.amount, pj.status, pj.fail_reason, pj.updated_at, pj.printed_at,
              p.display_name AS printer_name
       FROM print_jobs pj LEFT JOIN printers p ON p.id = pj.printer_id
       WHERE pj.machine_id=? AND pj.status IN ('PAID','PRINTING','PRINTED','FAILED','EXPIRED')
         AND pj.updated_at > NOW() - INTERVAL 24 HOUR
       ORDER BY pj.updated_at DESC LIMIT 100`,
      [req.machine.machine_id]
    );
    res.json({ jobs: rows });
  } catch (err) {
    console.error("AGENT RECENT ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

/* POST /api/agent/jobs/:jobId/start — the shopkeeper starts a COPY / SCAN order */
exports.startManualJob = async (req, res) => {
  try {
    const [r] = await db.query(
      `UPDATE print_jobs SET status='PRINTING', updated_at=NOW()
       WHERE job_id=? AND machine_id=? AND status='PAID' AND job_type IN ('COPY','SCAN')`,
      [req.params.jobId, req.machine.machine_id]
    );
    if (!r.affectedRows) return res.status(409).json({ error: "Only paid photocopy / scan orders can be started" });
    await logAudit(req.machine.machine_id, req.params.jobId, "JOB_PRINTING", { manual: true }, device(req));
    getIO().emit("job_status", { jobId: req.params.jobId, status: "PRINTING" });
    res.json({ success: true });
  } catch (err) {
    console.error("AGENT START ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

/* POST /api/agent/jobs/:jobId/scan-url → { url } — PUT the scanned PDF / JPG / PNG there */
exports.scanUrl = async (req, res) => {
  try {
    const [[job]] = await db.query(
      `SELECT job_type, status FROM print_jobs WHERE job_id=? AND machine_id=?`, [req.params.jobId, req.machine.machine_id]
    );
    if (!job || job.job_type !== "SCAN") return res.status(404).json({ error: "Scan order not found" });
    if (!["PAID", "PRINTING"].includes(job.status)) return res.status(409).json({ error: `Order is ${job.status}` });
    res.json({ url: scanUploadUrl(req.params.jobId) });
  } catch (err) {
    console.error("AGENT SCAN URL ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};
