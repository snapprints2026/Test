// src/services/fulfilment.service.js
// What happens to a job after payment, for both modules and every job type.
//
//   payment confirmed ──► markPaid()
//        KIOSK (Module 1): create OTP + QR → customer types the OTP at the kiosk → /kiosk/unlock
//        SHOP  (Module 2): give the order a pickup code → shop computer is told
//                          ("job_ready") → agent prints it (PRINT / FORM) or the
//                          shopkeeper does it at the counter (COPY / SCAN)
//   device reports done ──► markPrinted()  → file deleted, receipt created
//   device reports error ─► markFailed()   → automatic refund
//
// markPaid() is idempotent: the browser (verify-payment) and Razorpay's
// webhook may both report the same payment — whichever comes first does the
// work, the second just gets the same answer back.
//
// Kiosk OTP / QR codes are stored as an HMAC hash (what the kiosk compares)
// plus an encrypted copy (so the customer's own page can show it again).
const crypto = require("crypto");
const db = require("../database/db");
const { getIO, machineRoom } = require("../socket/socket");
const { logAudit, SYSTEM } = require("./audit.service");
const { deleteJobFile, deleteResultFile } = require("./file.service");
const { hashSecret, encryptString, decryptString } = require("./crypto.service");
const machines = require("./machine.service");
const invoices = require("./invoice.service");
const env = require("../config/env");
const { refundJob } = require("./refund.service");

// How long the kiosk OTP works after payment. Unused → EXPIRED + automatic refund.
const OTP_TTL_MS = env.OTP_TTL_MINUTES * 60 * 1000;
// Short reference shown to the customer, e.g. "SP-7KQ2MX" (no 0/O/1/I/L — easy to read out on a call).
const REF_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const generateRefCode = () => "SP-" + Array.from({ length: 6 }, () => REF_ALPHABET[crypto.randomInt(REF_ALPHABET.length)]).join("");
const generateOTP = () => crypto.randomInt(1000, 10000).toString(); // 4-digit kiosk OTP
const generateQrToken = () => crypto.randomBytes(32).toString("hex");

/* What the customer's page needs after payment. */
async function paidResponse(job, conn = db) {
  const [[m]] = await conn.query(`SELECT module FROM machines WHERE machine_id=?`, [job.machine_id]);
  const module = m ? m.module : "KIOSK";
  const base = {
    success: true, module, jobId: job.job_id, jobType: job.job_type || "PRINT", status: job.status,
    billing: job.billing || "CUSTOMER", refCode: job.ref_code || null,
  };
  if (module === "SHOP") return { ...base, orderCode: job.order_code };
  const [[t]] = await conn.query(`SELECT otp_enc, qr_enc, otp_expires_at FROM print_job_tokens WHERE job_id=?`, [job.job_id]);
  return {
    ...base,
    otp: t ? decryptString(t.otp_enc) : null,
    qrToken: t ? decryptString(t.qr_enc) : null,
    otpExpiresAt: t && t.otp_expires_at ? new Date(t.otp_expires_at).toISOString() : null,
  };
}

/**
 * @param {object} p { orderId, paymentId, method, details, amountPaise?, source }
 * @returns {Promise<{status:number, body:object}>}
 */
async function markPaid({ orderId, paymentId, method = null, details = null, amountPaise = null, source, utr = null, contact = null }) {
  const connection = await db.getConnection();
  let txStarted = false;
  let job;
  let module;
  try {
    await connection.beginTransaction();
    txStarted = true;

    const [rows] = await connection.query(
      `SELECT * FROM print_jobs WHERE payment_order_id=? FOR UPDATE`, [orderId]
    );
    if (!rows.length) {
      await connection.rollback();
      txStarted = false;
      return { status: 404, body: { error: "Job not found for this payment" } };
    }
    job = rows[0];

    // Already handled (e.g. webhook arrived first) → same answer again.
    if (job.status !== "PAYING") {
      await connection.rollback();
      txStarted = false;
      if (job.payment_id === paymentId && ["PAID", "PRINTING", "PRINTED"].includes(job.status)) {
        return { status: 200, body: await paidResponse(job) };
      }
      return { status: 409, body: { error: "Already processed" } };
    }

    if (amountPaise !== null && Math.round(Number(job.amount) * 100) !== Number(amountPaise)) {
      await connection.rollback();
      txStarted = false;
      console.error(`PAYMENT AMOUNT MISMATCH job=${job.job_id} expected=${job.amount} got=${amountPaise / 100}`);
      return { status: 400, body: { error: "Amount mismatch" } };
    }

    const machine = await machines.getMachine(job.machine_id, connection);
    module = machine ? machine.module : "KIOSK";
    const orderCode = module === "SHOP" ? await machines.newOrderCode(job.machine_id, connection) : null;

    await connection.query(
      `UPDATE print_jobs
       SET status='PAID', payment_id=?, payment_method=?, payment_details=?, order_code=?, utr=?, payer_contact=?, updated_at=NOW()
       WHERE id=?`,
      [paymentId, method, details ? JSON.stringify(details) : null, orderCode, utr, contact, job.id]
    );

    // Reference code for support. Unique in the DB; retry on the rare clash.
    let refCode = job.ref_code || null;
    for (let i = 0; !refCode && i < 5; i++) {
      const candidate = generateRefCode();
      try {
        await connection.query(`UPDATE print_jobs SET ref_code=? WHERE id=?`, [candidate, job.id]);
        refCode = candidate;
      } catch (e) {
        if (e.code !== "ER_DUP_ENTRY") throw e;
      }
    }
    job.ref_code = refCode;

    if (module === "KIOSK") {
      const expiry = new Date(Date.now() + OTP_TTL_MS);
      const otp = generateOTP();
      const qr = generateQrToken();
      await connection.query(
        `INSERT INTO print_job_tokens (job_id, otp_hash, otp_enc, otp_verified, otp_expires_at, qr_hash, qr_enc, qr_expires_at)
         VALUES (?, ?, ?, 0, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           otp_hash=VALUES(otp_hash), otp_enc=VALUES(otp_enc), otp_verified=0, otp_expires_at=VALUES(otp_expires_at),
           qr_hash=VALUES(qr_hash), qr_enc=VALUES(qr_enc), qr_expires_at=VALUES(qr_expires_at)`,
        [job.job_id, hashSecret(otp), encryptString(otp), expiry, hashSecret(qr), encryptString(qr), expiry]
      );
    }

    await connection.commit();
    txStarted = false;
    job = { ...job, status: "PAID", payment_id: paymentId, order_code: orderCode };
  } catch (err) {
    if (txStarted) await connection.rollback().catch(() => {});
    throw err;
  } finally {
    connection.release();
  }

  await logAudit(job.machine_id, job.job_id, "JOB_PAID", { source, module, billing: job.billing, jobType: job.job_type, ref_code: job.ref_code, method, utr }, SYSTEM);

  // Notify only after commit. No file paths in any event.
  const event = { jobId: job.job_id, machineId: job.machine_id, jobType: job.job_type };
  const io = getIO();
  io.to(machineRoom(job.machine_id)).emit("payment_success", event);       // kiosk (Module 1)
  if (module === "SHOP") io.to(machineRoom(job.machine_id)).emit("job_ready", event); // shop computer
  io.emit("job_status", { jobId: job.job_id, status: "PAID" });          // dashboards / customer page

  return { status: 200, body: await paidResponse(job) };
}

/* Device reports success. Works for both modules (job must be PRINTING;
   COPY / SCAN orders done at a shop counter may also go straight from PAID). */
async function markPrinted(machineId, jobId, actor = null) {
  const [[job]] = await db.query(
    `SELECT file_path, status, job_type, result_path FROM print_jobs WHERE job_id=? AND machine_id=?`, [jobId, machineId]
  );
  if (!job) return { status: 404, body: { error: "Job not found" } };
  if (job.status === "PRINTED") return { status: 200, body: { success: true, already: true } };
  const allowed = machines.MANUAL_JOB_TYPES.has(job.job_type) ? ["PRINTING", "PAID"] : ["PRINTING"];
  if (!allowed.includes(job.status)) return { status: 400, body: { error: "Invalid job state" } };
  if (job.job_type === "SCAN" && !job.result_path)
    return { status: 409, body: { error: "Upload the scanned file first" } };

  const [result] = await db.query(
    `UPDATE print_jobs SET status='PRINTED', printed_at=NOW()
     WHERE job_id=? AND machine_id=? AND status=?`,
    [jobId, machineId, job.status]
  );
  if (!result.affectedRows) return { status: 409, body: { error: "State transition failed" } };

  await db.query(`DELETE FROM print_job_tokens WHERE job_id=?`, [jobId]);
  await logAudit(machineId, jobId, "JOB_PRINTED", { jobType: job.job_type }, actor || { type: "DEVICE" });
  if (job.file_path) await deleteJobFile(jobId, job.file_path, "printed"); // row stays for revenue & history

  invoices.createCustomerReceipt(jobId).catch(() => {}); // GST receipt (non-blocking)

  getIO().emit("job_printed", { jobId });
  getIO().emit("job_status", { jobId, status: "PRINTED" });
  return { status: 200, body: { success: true } };
}

/* Device reports failure → FAILED + automatic refund. `fromStatuses` lets the
   shop agent / cron also fail jobs that never started printing. */
async function markFailed(machineId, jobId, reason = null, fromStatuses = ["PRINTING"], actor = null, reasonCode = "PRINTER_ERROR") {
  const [[job]] = await db.query(
    `SELECT payment_id, amount, billing, file_path, result_path, status FROM print_jobs WHERE job_id=? AND machine_id=?`,
    [jobId, machineId]
  );
  if (!job || !fromStatuses.includes(job.status)) return { status: 400, body: { error: "Invalid state" } };

  const [r] = await db.query(
    `UPDATE print_jobs SET status='FAILED', fail_reason=?, updated_at=NOW()
     WHERE job_id=? AND machine_id=? AND status=?`,
    [reason ? String(reason).slice(0, 255) : null, jobId, machineId, job.status]
  );
  if (!r.affectedRows) return { status: 400, body: { error: "State transition failed" } };

  let refundId = null;
  try {
    const r = await refundJob(jobId, { reason: `${reasonCode}${reason ? `: ${String(reason).slice(0, 150)}` : ""}` });
    refundId = r.refundId || null;
  } catch (e) {
    if (e.status !== 400) console.error("REFUND ERROR:", e.message); // refund_status=FAILED → visible to admin
  }

  await logAudit(machineId, jobId, "JOB_FAILED", { refund_id: refundId, reason }, actor || SYSTEM);
  if (job.file_path) await deleteJobFile(jobId, job.file_path, "failed");
  if (job.result_path) await deleteResultFile(jobId, job.result_path);
  getIO().emit("job_status", { jobId, status: "FAILED" });
  return { status: 200, body: { success: true, refundId } };
}

module.exports = { markPaid, markPrinted, markFailed, paidResponse };
