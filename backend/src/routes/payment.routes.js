// src/routes/payment.routes.js
// (The Razorpay webhook is mounted separately in app.js because it needs the raw body.)
const express = require("express");
const router = express.Router();
const payment = require("../controllers/payment.controller");
const { customerAuth } = require("../middleware/verifyCustomerToken");

router.post("/create-payment", customerAuth, payment.createPayment);
// Razorpay's signature proves this request; no customer token needed
router.post("/verify-payment", payment.verifyPayment);
// Local testing only (PAYMENT_MODE=mock)
router.post("/mock-pay", payment.mockPay);

module.exports = router;
