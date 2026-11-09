import axiosClient from "./axiosClient";

const get = (url) => axiosClient.get(url).then((r) => r.data);
const post = (url, body) => axiosClient.post(url, body).then((r) => r.data);
const qs = (params = {}) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")).toString();
  return q ? `?${q}` : "";
};

// Read-only department officer portal (scoped to the officer's organisation tree)
export const officerApi = {
  me: () => get("/officer/me"),
  getOrganizations: () => get("/officer/organizations"),
  getOverview: (params) => get(`/officer/overview${qs(params)}`),
  getUsage: (params) => get(`/officer/usage${qs(params)}`),
  usageCsvPath: (params) => `/officer/usage${qs({ ...params, format: "csv" })}`,
  getMachines: () => get("/officer/machines"),
  getContracts: () => get("/officer/contracts"),
  getRates: (machineId) => get(`/officer/rates${qs({ machineId })}`),
  getInvoices: (params) => get(`/officer/invoices${qs(params)}`),
  invoicePdfPath: (id) => `/officer/invoices/${id}/pdf`,
  getSettlements: () => get("/officer/settlements"),
  getSla: (params) => get(`/officer/sla${qs(params)}`),
  getDowntime: (params) => get(`/officer/downtime${qs(params)}`),
  getTickets: (status) => get(`/officer/tickets${qs({ status })}`),
  getTicket: (id) => get(`/officer/tickets/${id}`),
  createTicket: (payload) => post("/officer/tickets", payload),
  updateTicket: (id, payload) => post(`/officer/tickets/${id}/updates`, payload),
};
