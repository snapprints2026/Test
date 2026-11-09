// src/routes/admin.routes.js — every route needs an admin login (Bearer token).
// Reading is open to every admin role; changes need the right role:
//   CAN_MANAGE  SUPER_ADMIN, ADMIN            machines, vendors, organisations, contracts, forms
//   CAN_FINANCE SUPER_ADMIN, ADMIN, FINANCE   invoices, settlements, withdrawals, pricing approval
//   CAN_SUPPORT SUPER_ADMIN, ADMIN, SUPPORT   tickets, machine settings, downtime notes
//   CAN_REFUND  every admin role except none  manual refunds
//   SUPER_ONLY  SUPER_ADMIN                   admin users
const express = require("express");
const router = express.Router();

const admin = require("../controllers/admin.controller");
const gov = require("../controllers/gov.controller");
const pricing = require("../controllers/pricing.controller");
const forms = require("../controllers/forms.controller");
const billing = require("../controllers/billing.controller");
const sla = require("../controllers/sla.controller");
const tickets = require("../controllers/ticket.controller");
const issue = require("../controllers/issue.controller");
const {
  verifyAdminToken, CAN_MANAGE, CAN_FINANCE, CAN_SUPPORT, CAN_REFUND, SUPER_ONLY,
} = require("../middleware/verifyStaffToken");

router.use(verifyAdminToken);

router.get("/me", admin.getMe);

/* ── Overview ── */
router.get("/stats", admin.getStats);
router.get("/alerts", admin.getAlerts);
router.get("/live-jobs", admin.getLiveJobs);
router.get("/revenue", admin.getRevenue);
router.get("/revenue-overview", admin.getRevenueOverview);

/* ── Machines (both modules) ── */
router.post("/createmachine", CAN_MANAGE, admin.createMachine);
router.get("/machines", admin.getMachines);
router.get("/machineinfo", admin.getMachineInfo);
router.get("/machine-report/:machineId", admin.machineReport);
router.put("/machines/:machineId", CAN_MANAGE, admin.updateMachine);
router.delete("/machines/:machineId", CAN_MANAGE, admin.deleteMachine);
// { module?, requireLogin?, organizationId?, contractId?, enabledJobTypes?, billingMode?, staffPin?,
//   defaultLanguage?, assetTag?, printerModel?, installedAt?, status?, isPrintLocked? }
router.patch("/machines/:machineId/settings", CAN_SUPPORT, admin.updateMachineSettings);
router.post("/machines/:machineId/setup-code", CAN_MANAGE, admin.newSetupCode);
router.patch("/machines/:machineId/assign", CAN_MANAGE, admin.assignMachineToVendor);
router.patch("/machines/:machineId/unassign", CAN_MANAGE, admin.unassignMachine);
router.get("/machines/:machineId/jobs", admin.getMachineJobs);

/* ── Module 2 printers ── */
router.patch("/printers/:printerId", CAN_SUPPORT, admin.updatePrinter);

/* ── Vendors ── */
router.post("/vendors", CAN_MANAGE, admin.createVendor);   // { …, allowedModules, segment, strictPrivacy }
router.get("/vendors", admin.getVendors);
router.get("/vendors/:vendorId", admin.getVendorDetail);
router.patch("/vendors/:vendorId", CAN_MANAGE, admin.updateVendor);

/* ── Customers ── */
router.get("/customers", admin.getCustomers);
router.get("/customers/:customerId", admin.getCustomerDetail);

/* ── Manual refunds ── */
router.post("/jobs/:jobId/refund", CAN_REFUND, admin.refundJob);

/* ── Customer issues ("paid but no print") + support search ── */
router.get("/issues", issue.listIssues);
router.patch("/issues/:issueId", CAN_REFUND, issue.resolveIssue);
router.get("/jobs/search", issue.searchJobs);
router.post("/jobs/:jobId/issue", CAN_SUPPORT, issue.openIssueForJob);

/* ── Withdrawals ── */
router.get("/withdrawals", admin.getWithdrawals);
router.patch("/withdrawals/:withdrawalId", CAN_FINANCE, admin.updateWithdrawalStatus);

/* ── Government: organisations, officers, contracts ── */
router.get("/organizations", gov.listOrganizations);
router.post("/organizations", CAN_MANAGE, gov.createOrganization);
router.get("/organizations/:orgId", gov.getOrganization);
router.patch("/organizations/:orgId", CAN_MANAGE, gov.updateOrganization);
router.delete("/organizations/:orgId", CAN_MANAGE, gov.deleteOrganization);
router.post("/officers", CAN_MANAGE, gov.createOfficer);
router.patch("/officers/:officerId", CAN_MANAGE, gov.updateOfficer);
router.get("/contracts", gov.listContracts);
router.post("/contracts", CAN_MANAGE, gov.createContract);
router.get("/contracts/:contractId", gov.getContract);
router.patch("/contracts/:contractId", CAN_MANAGE, gov.updateContract);
router.post("/contracts/:contractId/machines", CAN_MANAGE, gov.attachMachines);
router.delete("/contracts/:contractId/machines/:machineId", CAN_MANAGE, gov.detachMachine);

/* ── Pricing rules (approved rates with history) ── */
router.get("/pricing-rules", pricing.listRules);
router.post("/pricing-rules", CAN_FINANCE, pricing.createRule);
router.post("/pricing-rules/:ruleId/approve", CAN_FINANCE, pricing.approveRule);
router.post("/pricing-rules/:ruleId/reject", CAN_FINANCE, pricing.rejectRule);
router.post("/pricing-rules/:ruleId/retire", CAN_FINANCE, pricing.retireRule);
router.get("/pricing/preview", pricing.preview);

/* ── Form catalogue ── */
router.get("/forms", forms.listForms);
router.post("/forms", CAN_MANAGE, forms.createForm);
router.patch("/forms/:formId", CAN_MANAGE, forms.updateForm);
router.post("/forms/:formId/upload-url", CAN_MANAGE, forms.formUploadUrl);
router.post("/forms/:formId/complete-upload", CAN_MANAGE, forms.completeFormUpload);
router.get("/forms/:formId/preview", forms.previewForm);

/* ── Invoices + settlements ── */
router.get("/invoices", billing.listInvoices(false));
router.post("/invoices/generate", CAN_FINANCE, billing.generateInvoice);
router.post("/invoices/manual", CAN_FINANCE, billing.manualInvoice);
router.get("/invoices/:invoiceId", billing.getInvoice(false));
router.get("/invoices/:invoiceId/pdf", billing.invoicePdf(false));
router.patch("/invoices/:invoiceId", CAN_FINANCE, billing.updateInvoice);
router.get("/settlements", billing.listSettlements(false));
router.post("/settlements/generate", CAN_FINANCE, billing.generateSettlement);
router.patch("/settlements/:settlementId", CAN_FINANCE, billing.updateSettlement);

/* ── SLA ── */
router.get("/sla", sla.listReports(false));
router.post("/sla/generate", CAN_SUPPORT, sla.generate);
router.get("/downtime", sla.listDowntime(false));
router.post("/downtime", CAN_SUPPORT, sla.addMaintenance);
router.patch("/downtime/:eventId", CAN_SUPPORT, sla.updateDowntime);

/* ── Support tickets ── */
router.get("/tickets", tickets.list);
router.post("/tickets", CAN_SUPPORT, tickets.create);
router.get("/tickets/:ticketId", tickets.get);
router.post("/tickets/:ticketId/updates", CAN_SUPPORT, tickets.update);

/* ── Audit log + admin users ── */
router.get("/audit", admin.getAuditLogs);
router.get("/admin-users", SUPER_ONLY, admin.getAdminUsers);
router.post("/admin-users", SUPER_ONLY, admin.createAdminUser);
router.patch("/admin-users/:adminId", SUPER_ONLY, admin.updateAdminUser);

module.exports = router;
