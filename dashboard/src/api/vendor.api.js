import axiosClient from "./axiosClient";

export const vendorApi = {
  getMe: () => axiosClient.get("/vendor/me").then((r) => r.data),

  getMachines: () => axiosClient.get("/vendor/machines").then((r) => r.data),
  getMachineRevenue: (machineId, range) =>
    axiosClient.get(`/vendor/machines/${machineId}/revenue?range=${range}`).then((r) => r.data),

  // Module 2 (shop computer)
  getMachinePrinters: (machineId) =>
    axiosClient.get(`/vendor/machines/${machineId}/printers`).then((r) => r.data),
  getMachineOrders: (machineId) =>
    axiosClient.get(`/vendor/machines/${machineId}/orders`).then((r) => r.data),
  setPrinterEnabled: (printerId, isEnabled) =>
    axiosClient.patch(`/vendor/printers/${printerId}`, { isEnabled }).then((r) => r.data),

  getRevenueSummary: (range) =>
    axiosClient.get(`/vendor/revenue-summary?range=${range}`).then((r) => r.data),
  getBalance: () => axiosClient.get("/vendor/balance").then((r) => r.data),

  getBankAccount: () => axiosClient.get("/vendor/bank-account").then((r) => r.data),
  upsertBankAccount: (payload) =>
    axiosClient.post("/vendor/bank-account", payload).then((r) => r.data),

  getWithdrawals: () => axiosClient.get("/vendor/withdrawals").then((r) => r.data),
  requestWithdrawal: (amount) =>
    axiosClient.post("/vendor/withdrawals", { amount }).then((r) => r.data),
};

// Revenue share + support tickets
vendorApi.getSettlements = () => axiosClient.get("/vendor/settlements").then((r) => r.data);
vendorApi.getTickets = (status) => axiosClient.get(`/vendor/tickets${status ? `?status=${status}` : ""}`).then((r) => r.data);
vendorApi.getTicket = (id) => axiosClient.get(`/vendor/tickets/${id}`).then((r) => r.data);
vendorApi.createTicket = (payload) => axiosClient.post("/vendor/tickets", payload).then((r) => r.data);
vendorApi.updateTicket = (id, payload) => axiosClient.post(`/vendor/tickets/${id}/updates`, payload).then((r) => r.data);
