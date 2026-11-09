// src/api/machine.api.js — public kiosk info
import { apiRequest } from "./client";

/** → { machine_id, name, location_name, module: "KIOSK"|"SHOP", require_login, is_online,
 *      paper_level, is_print_locked, capabilities (SHOP only), payment_mode: "razorpay"|"mock" } */
export const getMachineStatus = (machineId) =>
  apiRequest(`/machines/${encodeURIComponent(machineId)}/status`, { auth: false });

/** → { forms: [{ id, code, title, title_hi, title_mr, category, pages, defaultCopies, color, … }] } */
export const getForms = (machineId) =>
  apiRequest(`/machines/${encodeURIComponent(machineId)}/forms`, { auth: false });
