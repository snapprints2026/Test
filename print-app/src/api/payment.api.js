// src/api/payment.api.js — Razorpay order + verification
import { apiRequest } from "./client";

/** → { key, amount (paise), orderId, mock } */
export const createPayment = (jobId) =>
  apiRequest("/create-payment", { method: "POST", body: { jobId } });

/** body = Razorpay handler response
 *  → KIOSK: { success, module: "KIOSK", otp, qrToken }
 *  → SHOP:  { success, module: "SHOP", orderCode } */
export const verifyPayment = (razorpayResponse) =>
  apiRequest("/verify-payment", { method: "POST", body: razorpayResponse, auth: false });

/** PAYMENT_MODE=mock on the backend (laptop testing only) → same answer as verifyPayment */
export const mockPay = (orderId) =>
  apiRequest("/mock-pay", { method: "POST", body: { orderId }, auth: false });
