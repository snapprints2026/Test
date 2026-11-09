// src/services/consent.service.js
// DPDP Act 2023: a consent record for every order (and every OTP login).
// The print page shows a short notice (purpose, what we keep, how long,
// grievance officer) and the customer ticks "I agree" before uploading.
const db = require("../database/db");
const env = require("../config/env");
const { hashSecret } = require("./crypto.service");

/* body.consent = { accepted: true, version: "2026-10", language: "hi" } */
function readConsent(body) {
  const c = body && body.consent;
  if (!c || c.accepted !== true) return null;
  return {
    version: String(c.version || env.CONSENT_NOTICE_VERSION).slice(0, 20),
    language: ["en", "hi", "mr"].includes(c.language) ? c.language : null,
  };
}

async function recordConsent({ customerId = null, jobId = null, machineId = null, consent, ip, purpose = "PRINT_SERVICE" }, conn = db) {
  if (!consent) return;
  try {
    await conn.query(
      `INSERT INTO consents (customer_id, job_id, machine_id, purpose, notice_version, language, ip_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [customerId, jobId, machineId, purpose, consent.version, consent.language, ip ? hashSecret(ip) : null]
    );
  } catch (err) {
    console.error("CONSENT RECORD ERROR:", err.message);
  }
}

/* What the print page shows (public, per machine). */
function noticeInfo() {
  return {
    version: env.CONSENT_NOTICE_VERSION,
    required: env.CONSENT_REQUIRED,
    grievance: { name: env.GRIEVANCE_NAME, email: env.GRIEVANCE_EMAIL },
    policyUrl: env.PRIVACY_POLICY_URL || null,
    fileRetentionMinutes: env.UPLOAD_MAX_AGE_MINUTES,
    scanRetentionMinutes: env.SCAN_RESULT_TTL_MINUTES,
  };
}

module.exports = { readConsent, recordConsent, noticeInfo };
