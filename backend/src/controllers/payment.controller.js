// src/controllers/payment.controller.js
const crypto = require("crypto");
const db = require("../database/db");
const env = require("../config/env");
const { quoteJob } = require("../services/pricing.service");
const payment = require("../services/payment.service");
const machines = require("../services/machine.service");
const { markPaid } = require("../services/fulfilment.service");
const { jobOwnerFilter } = require("../middleware/verifyCustomerToken");

/* POST /api/create-payment   { jobId }
   → { key, amount (paise), orderId, mock }
   → or, when the approved rate makes the order free: the paid answer directly ({ success, free: true, … }) */
exports.createPayment = async (req, res) => {
  try {
    const { jobId } = req.body;
    const owner = jobOwnerFilter(req);
    const [[job]] = await db.query(
      `SELECT * FROM print_jobs WHERE job_id=? AND ${owner.sql} AND status='CREATED'`,
      [jobId, ...owner.params]
    );
    if (!job) return res.status(409).json({ error: "Invalid job state" });
    const needsFile = job.job_type === "PRINT" || job.job_type === "FORM";
    if ((needsFile && !job.file_path) || !(job.total_pages > 0))
      return res.status(409).json({ error: "Upload not finished yet" });

    const machine = await machines.getContext(job.machine_id);
    if (!machine || machine.status !== "ACTIVE") return res.status(404).json({ error: "Machine not found" });
    if (machines.loginRequired(machine) && !req.customer)
      return res.status(401).json({ error: "Please log in to continue" });
    if (machine.billing_mode === "DEPARTMENT")
      return res.status(409).json({ error: "This machine is billed to the department. Enter the staff code.", code: "DEPARTMENT_BILLED" });
    if (machine.is_print_locked)
      return res.status(400).json({ error: "Machine out of paper. Payment disabled." });
    // Don't take money for a printer that isn't connected
    if (env.REQUIRE_MACHINE_ONLINE && !machines.isOnline(machine))
      return res.status(503).json({ error: "The printer is offline right now. Please try again in a few minutes.", code: "MACHINE_OFFLINE" });

    if (machine.module === "SHOP" && job.job_type !== "SCAN") {
      const options = { color: job.color, paperSize: job.paper_size, printSide: job.print_side };
      if (!(await machines.shopCanPrint(machine.machine_id, options)))
        return res.status(400).json({ error: "This shop can't print with these options. Please change them." });
    }

    const price = await quoteJob(job, machine);

    // Approved rate of ₹0 (free government service): no payment step at all.
    if (price.paise === 0) {
      const orderId = `free_${crypto.randomBytes(8).toString("hex")}`;
      await db.query(
        `UPDATE print_jobs SET amount=0, unit_rate=?, pricing_rule_id=?, payment_order_id=?, status='PAYING' WHERE job_id=?`,
        [price.rate, price.ruleId, orderId, jobId]
      );
      const result = await markPaid({ orderId, paymentId: orderId, method: "free", source: "free" });
      return res.status(result.status).json({ ...result.body, free: true });
    }

    if (!payment.isEnabled()) return res.status(503).json({ error: "Payment service unavailable" });
    const amount = price.paise;
    if (amount < 100 && payment.MODE === "razorpay")
      return res.status(400).json({ error: "Minimum online payment is ₹1. Add a copy or a page." });
    const order = await payment.createOrder(amount, jobId);

    await db.query(
      `UPDATE print_jobs SET amount=?, unit_rate=?, pricing_rule_id=?, payment_order_id=?, status='PAYING' WHERE job_id=?`,
      [price.total, price.rate, price.ruleId, order.id, jobId]
    );
    res.json({ key: payment.keyId, amount, orderId: order.id, mock: payment.isMock() });
  } catch (err) {
    console.error("CREATE PAYMENT ERROR:", err);
    res.status(500).json({ error: "Payment creation failed" });
  }
};

/* POST /api/verify-payment   { razorpay_order_id, razorpay_payment_id, razorpay_signature }
   Called by the customer's browser right after Razorpay checkout succeeds. */
exports.verifyPayment = async (req, res) => {
  if (!payment.isEnabled()) return res.status(503).json({ error: "Payment service unavailable" });

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature)
    return res.status(400).json({ error: "Missing payment fields" });
  if (payment.isMock() !== String(razorpay_order_id).startsWith("mock_order_"))
    return res.status(400).json({ error: "Invalid payment" });
  if (!payment.verifySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature))
    return res.status(400).json({ error: "Invalid signature" });

  try {
    const { method, details, utr, contact } = await payment.fetchPaymentMethod(razorpay_payment_id);
    const result = await markPaid({
      orderId: razorpay_order_id, paymentId: razorpay_payment_id, method, details, utr, contact, source: "checkout",
    });
    res.status(result.status).json(result.body);
  } catch (err) {
    console.error("VERIFY PAYMENT ERROR:", err);
    res.status(500).json({ error: "Payment verification failed" });
  }
};

/* POST /api/payments/razorpay-webhook   (raw body — mounted before express.json in app.js)
   Razorpay calls this server-to-server, so a paid job is never lost even if the
   customer closes the page before verify-payment runs.
   Razorpay dashboard → Settings → Webhooks → URL https://<backend>/api/payments/razorpay-webhook,
   events: payment.captured, order.paid. Put the webhook secret in RAZORPAY_WEBHOOK_SECRET. */
exports.razorpayWebhook = async (req, res) => {
  const signature = req.headers["x-razorpay-signature"];
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  if (!payment.verifyWebhookSignature(raw, signature)) return res.status(400).json({ error: "Invalid signature" });

  let event;
  try {
    event = JSON.parse(raw.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "Bad JSON" });
  }

  try {
    if (event.event === "payment.captured" || event.event === "order.paid") {
      const p = event.payload?.payment?.entity;
      if (p && p.order_id && p.status === "captured") {
        const { method, details, utr, contact } = payment.describePayment(p);
        const result = await markPaid({
          orderId: p.order_id, paymentId: p.id, method, details, utr, contact, amountPaise: p.amount, source: "webhook",
        });
        if (result.status >= 400 && result.status !== 409 && result.status !== 404)
          console.error("WEBHOOK markPaid:", result.body);
      }
    }
    // Always 200 for events we understood, otherwise Razorpay keeps retrying.
    res.json({ ok: true });
  } catch (err) {
    console.error("WEBHOOK ERROR:", err);
    res.status(500).json({ error: "Webhook failed" }); // Razorpay will retry
  }
};

/* POST /api/mock-pay   { orderId } — PAYMENT_MODE=mock only (never in production).
   Stands in for Razorpay checkout + verify-payment while testing locally. */
exports.mockPay = async (req, res) => {
  if (!payment.isMock() || env.IS_PROD) return res.status(404).json({ error: "Not found" });
  const { orderId } = req.body;
  if (!orderId || !String(orderId).startsWith("mock_order_")) return res.status(400).json({ error: "orderId required" });
  try {
    const result = await markPaid({
      orderId, paymentId: `mock_pay_${Date.now()}`, method: "mock", details: null, source: "mock",
    });
    res.status(result.status).json(result.body);
  } catch (err) {
    console.error("MOCK PAY ERROR:", err);
    res.status(500).json({ error: "Mock payment failed" });
  }
};
