// src/api/support.api.js — "Report a problem" from the print page
import { apiRequest } from "./client";

/** → { ticketNo } */
export const reportProblem = ({ machineId, jobId, category, message, phone }) =>
  apiRequest("/support/tickets", { method: "POST", body: { machineId, jobId, category, message, phone } });
