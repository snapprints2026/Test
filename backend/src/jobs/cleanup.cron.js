// src/jobs/cleanup.cron.js
// Runs every 5 minutes:
//  1. Unpaid jobs (CREATED) older than 30 min → file + row deleted (abandoned uploads)
//  2. KIOSK: paid jobs whose OTP/QR expired unused → EXPIRED + automatic refund
//     (plus a safety net for expired jobs whose refund didn't go through)
//     SHOP:  paid jobs no printer picked up within SHOP_QUEUE_EXPIRY_MINUTES
//            → FAILED + automatic refund (the customer can't do anything about it)
//  3. Any job file older than UPLOAD_MAX_AGE_MINUTES is deleted from R2,
//     unless the job is PRINTING or PAID with a still-valid OTP.
//  4. SCAN orders: the scanned PDF is deleted once its download window
//     (SCAN_RESULT_TTL_MINUTES) is over.
//  5. PRINTING for more than 15 minutes with no printed / failed report → a case is
//     opened for the admin (the device probably crashed; it may have printed).
// PRINTED / FAILED / EXPIRED job rows are NEVER deleted — dashboards need them.
//
// Files are found through the database (no "list bucket" calls — those cost money
// on R2, deletes are free). The bucket's lifecycle rule (delete after 1 day)
// catches anything this misses, e.g. if the server was down.
const cron = require("node-cron");
const db = require("../database/db");
const env = require("../config/env");
const { deleteJobFile, deleteResultFile } = require("../services/file.service");
const { markFailed } = require("../services/fulfilment.service");
const { safeRefund } = require("../services/refund.service");

const BATCH = 500;

async function removeAbandonedJobs() {
  const [rows] = await db.query(
    `SELECT job_id, file_path FROM print_jobs
     WHERE status='CREATED' AND created_at < NOW() - INTERVAL 30 MINUTE
     LIMIT ${BATCH}`
  );
  for (const r of rows) {
    const ok = await deleteJobFile(r.job_id, r.file_path, "abandoned upload");
    if (ok) await db.query(`DELETE FROM print_jobs WHERE job_id=? AND status='CREATED'`, [r.job_id]);
  }
  return rows.length;
}

async function expireJobs() {
  const [rows] = await db.query(
    `SELECT pj.job_id FROM print_jobs pj
     INNER JOIN print_job_tokens pjt ON pj.job_id = pjt.job_id
     WHERE pj.status='PAID' AND pjt.otp_verified=0 AND pjt.otp_expires_at < NOW()
     LIMIT ${BATCH}`
  );
  for (const { job_id } of rows) {
    const [r] = await db.query(
      `UPDATE print_jobs SET status='EXPIRED', updated_at=NOW() WHERE job_id=? AND status='PAID'`, [job_id]
    );
    if (r.affectedRows) await safeRefund(job_id, "OTP_EXPIRED");
  }
  await db.query(`DELETE FROM print_job_tokens WHERE otp_expires_at < NOW() AND otp_verified=0`);

  // Safety net: EXPIRED jobs from the last 7 days that never got a refund
  // (Razorpay was down, the server restarted mid-way…).
  const [missed] = await db.query(
    `SELECT job_id FROM print_jobs
     WHERE status='EXPIRED' AND payment_id IS NOT NULL AND refund_status IS NULL AND billing='CUSTOMER'
       AND amount > 0 AND updated_at > NOW() - INTERVAL 7 DAY
     LIMIT 100`
  );
  for (const { job_id } of missed) await safeRefund(job_id, "OTP_EXPIRED");
  return rows.length;
}

/* PRINTING for > 15 min with no printed / failed report → the device probably
   crashed. Don't refund blindly (it may have printed); open a case instead. */
async function flagStuckJobs() {
  const [r] = await db.query(
    `INSERT IGNORE INTO job_issues (job_id, source, reason, details, status)
     SELECT job_id, 'SYSTEM', 'STUCK', 'Device did not confirm printed / failed within 15 minutes', 'OPEN'
     FROM print_jobs
     WHERE status='PRINTING' AND updated_at < NOW() - INTERVAL 15 MINUTE
     LIMIT ${BATCH}`
  );
  return r.affectedRows;
}

async function expireShopQueue() {
  const [rows] = await db.query(
    `SELECT pj.job_id, pj.machine_id FROM print_jobs pj
     INNER JOIN machines m ON m.machine_id = pj.machine_id AND m.module='SHOP'
     WHERE pj.status='PAID' AND pj.updated_at < NOW() - INTERVAL ? MINUTE
     LIMIT ${BATCH}`,
    [env.SHOP_QUEUE_EXPIRY_MINUTES]
  );
  for (const r of rows) {
    await markFailed(r.machine_id, r.job_id, "Not printed in time — refunded automatically", ["PAID"], null, "NOT_PRINTED_IN_TIME");
  }
  return rows.length;
}

async function removeOldFiles() {
  const [rows] = await db.query(
    `SELECT pj.job_id, pj.file_path
     FROM print_jobs pj
     LEFT JOIN print_job_tokens pjt ON pj.job_id = pjt.job_id
     WHERE pj.file_path IS NOT NULL
       AND pj.created_at < NOW() - INTERVAL ? MINUTE
       AND pj.status <> 'PRINTING'
       AND NOT (pj.status='PAID' AND (pjt.otp_expires_at > NOW() OR pjt.job_id IS NULL))
     LIMIT ${BATCH}`,
    [env.UPLOAD_MAX_AGE_MINUTES]
  );
  let deleted = 0;
  for (const r of rows) if (await deleteJobFile(r.job_id, r.file_path, "retention period over")) deleted++;
  return deleted;
}

async function removeExpiredScans() {
  const [rows] = await db.query(
    `SELECT job_id, result_path FROM print_jobs
     WHERE result_path IS NOT NULL AND result_expires_at < NOW() LIMIT ${BATCH}`
  );
  let n = 0;
  for (const r of rows) if (await deleteResultFile(r.job_id, r.result_path)) n++;
  return n;
}

async function runCleanup() {
  try {
    const n = await removeAbandonedJobs();
    if (n) console.log(`🧹 Removed ${n} abandoned upload(s)`);
  } catch (err) {
    console.error("CLEANUP ABANDONED ERROR:", err);
  }
  try {
    const n = await expireJobs();
    if (n) console.log(`⌛ Expired ${n} unused OTP job(s)`);
  } catch (err) {
    console.error("CLEANUP JOBS ERROR:", err);
  }
  try {
    const n = await flagStuckJobs();
    if (n) console.log(`⚠️  Flagged ${n} stuck job(s) for review`);
  } catch (err) {
    console.error("STUCK JOBS ERROR:", err);
  }
  try {
    const n = await expireShopQueue();
    if (n) console.log(`🧹 Refunded ${n} shop order(s) nobody printed`);
  } catch (err) {
    console.error("CLEANUP SHOP QUEUE ERROR:", err);
  }
  try {
    const n = await removeOldFiles();
    if (n) console.log(`🧹 Deleted ${n} old file(s)`);
  } catch (err) {
    console.error("CLEANUP FILES ERROR:", err);
  }
  try {
    const n = await removeExpiredScans();
    if (n) console.log(`🧹 Deleted ${n} expired scan(s)`);
  } catch (err) {
    console.error("CLEANUP SCANS ERROR:", err);
  }
}

function startCleanupCron() {
  cron.schedule("*/5 * * * *", runCleanup);
  console.log("✅ Cleanup cron scheduled (every 5 min)");
}

module.exports = { startCleanupCron, runCleanup };
