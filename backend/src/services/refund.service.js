// src/services/refund.service.js
// The ONE place that refunds a print job. Used by:
//   - device mark-failed (printer error)          → reason PRINTER_ERROR
//   - cleanup job (kiosk OTP expired unused,
//     shop order nobody printed in time)          → reason OTP_EXPIRED / NOT_PRINTED_IN_TIME
//   - customer report, auto-approved              → reason ISSUE_<reason>
//   - admin "Approve" / manual refund button      → reason ADMIN_...
//
// Safe to call twice: the row is "claimed" with refund_status='PROCESSING'
// before Razorpay is called, so a second call (another admin, the cron, a
// double-click) sees it and does nothing. The money always goes back to the
// customer's original UPI / card / bank — no bank details needed.
// Department-billed and free (₹0) orders have nothing to refund.
const db = require("../database/db");
const payment = require("./payment.service");
const { logAudit, SYSTEM } = require("./audit.service");

class RefundError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** True when the job took real money from the customer. */
const isRefundable = (job) =>
  !!job.payment_id && Number(job.amount) > 0 && (job.billing || "CUSTOMER") === "CUSTOMER" &&
  !["free", "department"].includes(job.payment_method);

/**
 * @returns {Promise<{refunded:boolean, refundId?:string, refundStatus?:string, alreadyRefunded?:boolean}>}
 */
async function refundJob(jobId, { reason = "REFUND", adminId = null, actor = null } = {}) {
  const [[job]] = await db.query(
    `SELECT job_id, machine_id, payment_id, payment_method, amount, billing, status, refund_status, refund_id
     FROM print_jobs WHERE job_id=?`,
    [jobId]
  );
  if (!job) throw new RefundError("Job not found", 404);
  if (!isRefundable(job)) throw new RefundError("No online payment was captured for this job — nothing to refund");
  if (!payment.isEnabled()) throw new RefundError("Payment service unavailable", 503);

  // Claim it. Only NULL (never refunded) or FAILED (last attempt failed) can be claimed.
  const [claim] = await db.query(
    `UPDATE print_jobs SET refund_status='PROCESSING', refund_reason=?
     WHERE job_id=? AND (refund_status IS NULL OR refund_status='FAILED')`,
    [String(reason).slice(0, 255), jobId]
  );
  if (!claim.affectedRows) {
    return { refunded: false, alreadyRefunded: true, refundId: job.refund_id, refundStatus: job.refund_status };
  }

  try {
    const r = await payment.refund(job.payment_id, job.amount, { job_id: jobId, reason: String(reason).slice(0, 200) });
    const refundStatus = r.status === "processed" || payment.isMock() ? "PROCESSED" : "PENDING";
    // A refunded job is not revenue: PAID / PRINTING / PRINTED become FAILED
    // (revenue only counts PRINTED). EXPIRED / FAILED stay as they are.
    await db.query(
      `UPDATE print_jobs
       SET refund_id=?, refund_amount=?, refund_status=?, refunded_at=NOW(),
           status = IF(status IN ('PAID','PRINTING','PRINTED'), 'FAILED', status),
           updated_at=NOW()
       WHERE job_id=?`,
      [r.id, Number(job.amount), refundStatus, jobId]
    );
    // An unused OTP must not work after the money is back
    await db.query(`DELETE FROM print_job_tokens WHERE job_id=?`, [jobId]);
    await logAudit(job.machine_id, jobId, "JOB_REFUNDED",
      { refund_id: r.id, refund_status: refundStatus, reason, admin_id: adminId },
      actor || (adminId ? { type: "ADMIN", id: adminId } : SYSTEM));
    return { refunded: true, refundId: r.id, refundStatus };
  } catch (err) {
    const msg = err?.error?.description || err.message || "Refund failed";
    await db.query(
      `UPDATE print_jobs SET refund_status='FAILED', refund_reason=? WHERE job_id=?`,
      [`${reason} — ${msg}`.slice(0, 255), jobId]
    ).catch(() => {});
    await logAudit(job.machine_id, jobId, "REFUND_FAILED", { reason, error: msg }, SYSTEM);
    throw new RefundError(`Refund failed: ${msg}`, 502);
  }
}

/* For background jobs: never throws, logs instead. */
async function safeRefund(jobId, reason) {
  try {
    const r = await refundJob(jobId, { reason });
    if (r.refunded) console.log(`💸 Auto refund ${jobId} (${reason}) → ${r.refundId}`);
    return r;
  } catch (e) {
    if (e.status !== 400) console.error(`AUTO REFUND ERROR ${jobId}:`, e.message);
    return null;
  }
}

module.exports = { refundJob, safeRefund, isRefundable, RefundError };
