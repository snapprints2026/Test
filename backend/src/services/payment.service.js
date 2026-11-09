// src/services/payment.service.js
// Razorpay order / signature / payment-method / refund logic.
// PAYMENT_MODE=mock (development only) fakes all of it so you can test the
// whole flow on your laptop without a Razorpay account.
const crypto = require("crypto");
const razorpay = require("../config/razorpay");
const env = require("../config/env");

const MODE = env.PAYMENT_MODE; // "razorpay" | "mock" | "disabled"
const isMock = () => MODE === "mock";

function isEnabled() {
  return isMock() || (MODE === "razorpay" && !!razorpay);
}

async function createOrder(amountPaise, jobId) {
  if (isMock()) return { id: `mock_order_${crypto.randomBytes(8).toString("hex")}`, amount: amountPaise };
  // Razorpay receipts are max 40 chars
  const receipt = `${jobId}_${Date.now()}`.slice(0, 40);
  return razorpay.orders.create({ amount: amountPaise, currency: "INR", receipt, notes: { jobId } });
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/* Checkout handler signature: HMAC(key_secret, "order_id|payment_id") */
function verifySignature(orderId, paymentId, signature) {
  if (isMock()) return true;
  const expected = crypto
    .createHmac("sha256", env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  return safeEqual(expected, signature);
}

/* Webhook signature: HMAC(webhook_secret, raw request body) */
function verifyWebhookSignature(rawBody, signature) {
  if (!env.RAZORPAY_WEBHOOK_SECRET || !signature) return false;
  const expected = crypto.createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest("hex");
  return safeEqual(expected, signature);
}

/* Payment method isn't in the checkout callback — fetch it. Non-fatal. */
async function fetchPaymentMethod(paymentId) {
  if (isMock()) return { method: "mock", details: null, utr: null, contact: null };
  if (!razorpay) return { method: null, details: null, utr: null, contact: null };
  try {
    const p = await razorpay.payments.fetch(paymentId);
    return describePayment(p);
  } catch (err) {
    console.error("RAZORPAY PAYMENT FETCH ERROR:", err.message);
    return { method: null, details: null, utr: null, contact: null };
  }
}

/* UPI IDs often contain a phone number or name — keep only enough to recognise
   it in a support call: "ra***@okaxis". */
function maskVpa(vpa) {
  const [user, handle] = String(vpa || "").split("@");
  return `${(user || "").slice(0, 2)}***${handle ? `@${handle}` : ""}`;
}

/* Same, from a payment entity we already have (webhook payload).
   Data minimisation: only the method and a masked identifier are kept. */
function describePayment(p) {
  const a = p.acquirer_data || {};
  const utr = a.rrn || a.upi_transaction_id || a.bank_transaction_id || null;
  const contact = p.contact ? String(p.contact).replace(/[^\d]/g, "").slice(-10) : null;
  const method = p.method || null; // upi | card | netbanking | wallet | emi
  let details = null;
  if (method === "upi" && p.vpa) details = { vpa: maskVpa(p.vpa) };
  else if (method === "card" && p.card)
    details = { network: p.card.network || null, last4: p.card.last4 || null };
  else if (method === "netbanking" && p.bank) details = { bank: p.bank };
  else if (method === "wallet" && p.wallet) details = { wallet: p.wallet };
  // utr = the reference the customer sees in GPay / PhonePe / their bank app;
  // contact = phone typed on the checkout. Both let support find a guest's payment.
  return { method, details, utr: utr ? String(utr).slice(0, 40) : null, contact: contact || null };
}

/* amountRupees is what's stored in print_jobs.amount; notes show in the Razorpay dashboard. */
async function refund(paymentId, amountRupees, notes = {}) {
  if (isMock()) return { id: `mock_refund_${crypto.randomBytes(6).toString("hex")}`, status: "processed" };
  if (!razorpay) throw new Error("Payment service unavailable");
  return razorpay.payments.refund(paymentId, { amount: Math.round(Number(amountRupees) * 100), speed: "normal", notes });
}

module.exports = {
  MODE,
  isMock,
  isEnabled,
  createOrder,
  verifySignature,
  verifyWebhookSignature,
  fetchPaymentMethod,
  describePayment,
  maskVpa,
  refund,
  keyId: env.RAZORPAY_KEY_ID,
};
