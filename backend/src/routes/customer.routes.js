// routes/customer.routes.js
const express = require("express");
const router  = express.Router();
const db      = require("../database/db");
const { verifyCustomerToken } = require("../middleware/verifyCustomerToken");
const { logAudit } = require("../services/audit.service");

// GET /api/customer/me
router.get("/me", verifyCustomerToken, async (req, res) => {
  try {
    const [[customer]] = await db.query(
      `SELECT name, phone FROM customers WHERE id=? AND deleted_at IS NULL`, [req.customer.customerId]
    );
    if (!customer) return res.status(401).json({ error: "Account not found. Please log in again." });
    res.json({ name: customer.name, mobile: customer.phone });
  } catch (err) {
    console.error("CUSTOMER ME ERROR:", err);
    res.status(500).json({ error: "Could not load profile" });
  }
});

// PATCH /api/customer/profile  { name }
router.patch("/profile", verifyCustomerToken, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: "Name is required" });

    await db.query(`UPDATE customers SET name=? WHERE id=?`, [name.trim(), req.customer.customerId]);
    res.json({ success: true, name: name.trim() });
  } catch (err) {
    console.error("CUSTOMER PROFILE UPDATE ERROR:", err);
    res.status(500).json({ error: "Could not update name" });
  }
});

// GET /api/customer/history
// Includes which machine (and where it's located) each job ran on, plus
// how it was paid — both useful for the customer's own record, and it's
// the same data admin sees on their side so support conversations line up.
router.get("/history", verifyCustomerToken, async (req, res) => {
  try {
    const [jobs] = await db.query(
      `SELECT
         pj.job_id, pj.job_type, pj.file_name, pj.color, pj.copies, pj.paper_size, pj.print_side,
         pj.total_pages, pj.amount, pj.status, pj.payment_method,
         pj.created_at, pj.printed_at,
         pj.ref_code, pj.payment_id IS NOT NULL AS is_paid, pj.billing,
         pj.refund_status, pj.refund_amount, ji.status AS issue_status,
         pj.machine_id, m.name AS machine_name,
         l.name AS location_name, l.city
       FROM print_jobs pj
       LEFT JOIN machines m ON m.machine_id = pj.machine_id
       LEFT JOIN locations l ON l.id = m.location_id
       LEFT JOIN job_issues ji ON ji.job_id = pj.job_id
       WHERE pj.customer_id=?
       ORDER BY pj.created_at DESC
       LIMIT 50`,
      [req.customer.customerId]
    );
    res.json({ jobs });
  } catch (err) {
    console.error("CUSTOMER HISTORY ERROR:", err);
    res.status(500).json({ error: "Could not load history" });
  }
});

// DELETE /api/customer/me — DPDP right to erasure.
// The phone number and name are removed and consents withdrawn. Order rows
// stay (without any link to the person) because invoices must be kept for
// tax purposes.
router.delete("/me", verifyCustomerToken, async (req, res) => {
  try {
    const id = req.customer.customerId;
    await db.query(
      `UPDATE customers SET name='Deleted', phone=CONCAT('deleted-', id), otp_hash=NULL, otp_expires_at=NULL,
         otp_verified=0, deleted_at=NOW() WHERE id=? AND deleted_at IS NULL`,
      [id]
    );
    await db.query(`UPDATE print_jobs SET customer_id=NULL WHERE customer_id=? AND status NOT IN ('PAYING','PAID','PRINTING')`, [id]);
    await db.query(`UPDATE consents SET withdrawn_at=NOW() WHERE customer_id=? AND withdrawn_at IS NULL`, [id]);
    await logAudit(null, null, "CUSTOMER_DATA_DELETED", null, { type: "CUSTOMER", id, ip: req.ip });
    res.json({ success: true });
  } catch (err) {
    console.error("CUSTOMER DELETE ERROR:", err);
    res.status(500).json({ error: "Could not delete your account" });
  }
});

module.exports = router;