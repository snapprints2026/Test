// src/routes/officer.routes.js → /api/officer/... (read-only department logins)
const express = require("express");
const router = express.Router();
const officer = require("../controllers/officer.controller");
const billing = require("../controllers/billing.controller");
const sla = require("../controllers/sla.controller");
const tickets = require("../controllers/ticket.controller");
const { verifyOfficerToken } = require("../middleware/verifyStaffToken");

router.use(verifyOfficerToken);

router.get("/me", officer.me);
router.get("/organizations", officer.organizations);
router.get("/overview", officer.overview);
router.get("/usage", officer.usage);              // ?groupBy=office|machine|month|job_type&format=csv
router.get("/machines", officer.machines);
router.get("/contracts", officer.contracts);
router.get("/rates", officer.rates);

router.get("/invoices", billing.listInvoices(true));
router.get("/invoices/:invoiceId", billing.getInvoice(true));
router.get("/invoices/:invoiceId/pdf", billing.invoicePdf(true));
router.get("/settlements", billing.listSettlements(true));

router.get("/sla", sla.listReports(true));
router.get("/downtime", sla.listDowntime(true));

router.get("/tickets", tickets.list);
router.post("/tickets", tickets.create);
router.get("/tickets/:ticketId", tickets.get);
router.post("/tickets/:ticketId/updates", tickets.update);

module.exports = router;
