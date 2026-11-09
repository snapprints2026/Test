import axiosClient from "./axiosClient";

const get = (url) => axiosClient.get(url).then((r) => r.data);
const post = (url, body) => axiosClient.post(url, body).then((r) => r.data);
const patch = (url, body) => axiosClient.patch(url, body).then((r) => r.data);
const del = (url) => axiosClient.delete(url).then((r) => r.data);
const qs = (params = {}) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")).toString();
  return q ? `?${q}` : "";
};

export const adminApi = {
  me: () => get("/admin/me"),

  // Overview
  getStats: () => get("/admin/stats"),
  getRevenue: (period) => get(`/admin/revenue?period=${period}`),
  getRevenueOverview: () => get("/admin/revenue-overview"),
  getAlerts: () => get("/admin/alerts"),
  getLiveJobs: () => get("/admin/live-jobs"),

  // Machines
  getMachineInfo: () => get("/admin/machineinfo"),
  createMachine: (payload) => post("/admin/createmachine", payload),
  updateMachine: (machineId, payload) => axiosClient.put(`/admin/machines/${machineId}`, payload).then((r) => r.data),
  deleteMachine: (machineId) => del(`/admin/machines/${machineId}`),
  machineReport: (machineId, period) => get(`/admin/machine-report/${machineId}?period=${period}`),
  assignMachine: (machineId, vendorId) => patch(`/admin/machines/${machineId}/assign`, { vendorId }),
  unassignMachine: (machineId) => patch(`/admin/machines/${machineId}/unassign`),
  // → { machine, printers, jobs }
  getMachineJobs: (machineId) => get(`/admin/machines/${machineId}/jobs`),
  // { module?, requireLogin?, organizationId?, contractId?, enabledJobTypes?, billingMode?, staffPin?, defaultLanguage?, … }
  updateMachineSettings: (machineId, payload) => patch(`/admin/machines/${machineId}/settings`, payload),
  newSetupCode: (machineId) => post(`/admin/machines/${machineId}/setup-code`),

  // Module 2 printers
  updatePrinter: (printerId, payload) => patch(`/admin/printers/${printerId}`, payload),

  // Refunds
  refundJob: (jobId) => post(`/admin/jobs/${jobId}/refund`),

  // Customer issues ("paid but no print") + support search
  getIssues: (status) => get(`/admin/issues?status=${status || "OPEN"}`),
  resolveIssue: (issueId, action, note) => patch(`/admin/issues/${issueId}`, { action, note }),
  searchJobs: (q) => get(`/admin/jobs/search?q=${encodeURIComponent(q)}`),
  openIssue: (jobId, reason, details) => post(`/admin/jobs/${jobId}/issue`, { reason, details }),

  // Vendors
  getVendors: () => get("/admin/vendors"),
  getVendorDetail: (vendorId) => get(`/admin/vendors/${vendorId}`),
  createVendor: (payload) => post("/admin/vendors", payload),
  // { allowedModules?, status?, segment?, strictPrivacy?, … }
  updateVendor: (vendorId, payload) => patch(`/admin/vendors/${vendorId}`, payload),

  // Customers
  getCustomers: () => get("/admin/customers"),
  getCustomerDetail: (customerId) => get(`/admin/customers/${customerId}`),

  // Withdrawals
  getWithdrawals: (status) => get(`/admin/withdrawals${status ? `?status=${status}` : ""}`),
  updateWithdrawalStatus: (withdrawalId, status, remarks) => patch(`/admin/withdrawals/${withdrawalId}`, { status, remarks }),

  // Government — organisations, officers, contracts
  getOrganizations: () => get("/admin/organizations"),
  getOrganization: (id) => get(`/admin/organizations/${id}`),
  createOrganization: (payload) => post("/admin/organizations", payload),
  updateOrganization: (id, payload) => patch(`/admin/organizations/${id}`, payload),
  deleteOrganization: (id) => del(`/admin/organizations/${id}`),
  createOfficer: (payload) => post("/admin/officers", payload),
  updateOfficer: (id, payload) => patch(`/admin/officers/${id}`, payload),
  getContracts: () => get("/admin/contracts"),
  getContract: (id) => get(`/admin/contracts/${id}`),
  createContract: (payload) => post("/admin/contracts", payload),
  updateContract: (id, payload) => patch(`/admin/contracts/${id}`, payload),
  attachMachines: (id, machineIds) => post(`/admin/contracts/${id}/machines`, { machineIds }),
  detachMachine: (id, machineId) => del(`/admin/contracts/${id}/machines/${machineId}`),

  // Pricing rules
  getPricingRules: (params) => get(`/admin/pricing-rules${qs(params)}`),
  createPricingRule: (payload) => post("/admin/pricing-rules", payload),
  approvePricingRule: (id, approvalRef) => post(`/admin/pricing-rules/${id}/approve`, { approvalRef }),
  rejectPricingRule: (id, notes) => post(`/admin/pricing-rules/${id}/reject`, { notes }),
  retirePricingRule: (id) => post(`/admin/pricing-rules/${id}/retire`),
  previewPrices: (machineId) => get(`/admin/pricing/preview${qs({ machineId })}`),

  // Forms
  getForms: () => get("/admin/forms"),
  createForm: (payload) => post("/admin/forms", payload),
  updateForm: (id, payload) => patch(`/admin/forms/${id}`, payload),
  formUploadUrl: (id) => post(`/admin/forms/${id}/upload-url`),
  completeFormUpload: (id, key) => post(`/admin/forms/${id}/complete-upload`, { key }),
  previewForm: (id) => get(`/admin/forms/${id}/preview`),

  // Invoices + settlements
  getInvoices: (params) => get(`/admin/invoices${qs(params)}`),
  getInvoice: (id) => get(`/admin/invoices/${id}`),
  generateInvoice: (payload) => post("/admin/invoices/generate", payload),
  manualInvoice: (payload) => post("/admin/invoices/manual", payload),
  updateInvoice: (id, payload) => patch(`/admin/invoices/${id}`, payload),
  invoicePdfPath: (id) => `/admin/invoices/${id}/pdf`,
  getSettlements: (params) => get(`/admin/settlements${qs(params)}`),
  generateSettlement: (payload) => post("/admin/settlements/generate", payload),
  updateSettlement: (id, payload) => patch(`/admin/settlements/${id}`, payload),

  // SLA
  getSla: (params) => get(`/admin/sla${qs(params)}`),
  generateSla: (month) => post("/admin/sla/generate", { month }),
  getDowntime: (params) => get(`/admin/downtime${qs(params)}`),
  updateDowntime: (id, payload) => patch(`/admin/downtime/${id}`, payload),
  addMaintenance: (payload) => post("/admin/downtime", payload),

  // Tickets
  getTickets: (status) => get(`/admin/tickets${qs({ status })}`),
  getTicket: (id) => get(`/admin/tickets/${id}`),
  createTicket: (payload) => post("/admin/tickets", payload),
  updateTicket: (id, payload) => post(`/admin/tickets/${id}/updates`, payload),

  // Audit + admin users
  getAudit: (params) => get(`/admin/audit${qs(params)}`),
  getAdminUsers: () => get("/admin/admin-users"),
  createAdminUser: (payload) => post("/admin/admin-users", payload),
  updateAdminUser: (id, payload) => patch(`/admin/admin-users/${id}`, payload),
};
