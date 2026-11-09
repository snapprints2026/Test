// src/routes/support.routes.js → /api/support/...
// "Report a problem" from the customer's print page (no login needed).
const express = require("express");
const router = express.Router();
const db = require("../database/db");
const tickets = require("../services/ticket.service");
const { customerAuth, jobOwnerFilter } = require("../middleware/verifyCustomerToken");
const { rateLimit } = require("../middleware/rateLimit");

const limit = rateLimit({ max: 5, windowMinutes: 60, message: "You've reported several problems already. We'll get back to you." });

/* POST /api/support/tickets   { machineId, jobId?, category, message, phone? } → { ticketNo } */
router.post("/tickets", limit, customerAuth, async (req, res) => {
  try {
    const { machineId, jobId, category, message, phone } = req.body || {};
    if (!machineId) return res.status(400).json({ error: "machineId is required" });
    const [[m]] = await db.query(`SELECT machine_id FROM machines WHERE machine_id=?`, [machineId]);
    if (!m) return res.status(404).json({ error: "Machine not found" });
    let job = null;
    if (jobId) {
      const owner = jobOwnerFilter(req);
      [[job]] = await db.query(`SELECT job_id, order_code, status FROM print_jobs WHERE job_id=? AND machine_id=? AND ${owner.sql}`,
        [jobId, machineId, ...owner.params]);
    }
    const text = String(message || "").trim();
    if (text.length < 3) return res.status(400).json({ error: "Please describe the problem" });
    const cat = tickets.CATEGORIES.includes(category) ? category : "OTHER";
    const t = await tickets.createTicket({
      machineId,
      jobId: job ? job.job_id : null,
      raisedByType: "CUSTOMER",
      raisedById: req.customer ? req.customer.customerId : null,
      contactPhone: /^[6-9]\d{9}$/.test(String(phone || "")) ? phone : req.customer?.mobile || null,
      category: cat,
      subject: `${cat.replace("_", " ").toLowerCase()} — ${job ? `order ${job.order_code || job.job_id} (${job.status})` : machineId}`,
      description: text.slice(0, 2000),
      authorName: "Customer",
    });
    res.json({ ticketNo: t.ticket_no });
  } catch (err) {
    console.error("CUSTOMER TICKET ERROR:", err);
    res.status(err.status || 500).json({ error: err.status ? err.message : "Could not send your report" });
  }
});

module.exports = router;
