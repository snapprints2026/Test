// routes/vendor.routes.js
const express = require("express");
const router  = express.Router();

const vendor  = require("../controllers/vendor.controller");
const tickets = require("../controllers/ticket.controller");
const { verifyVendorToken } = require("../middleware/verifyStaffToken");

// Every route below requires a valid vendor JWT.
router.use(verifyVendorToken);

router.get("/me", vendor.getMe);

router.get("/machines", vendor.getMyMachines);
router.get("/machines/:machineId/revenue", vendor.getMachineRevenue);

router.get("/machines/:machineId/printers", vendor.getMachinePrinters);
router.get("/machines/:machineId/orders", vendor.getMachineOrders);
router.patch("/printers/:printerId", vendor.setPrinterEnabled);

router.get("/revenue-summary", vendor.getRevenueSummary);
router.get("/balance", vendor.getAvailableBalance);

router.get("/bank-account", vendor.getBankAccount);
router.post("/bank-account", vendor.upsertBankAccount);

router.get("/withdrawals", vendor.getMyWithdrawals);
router.post("/withdrawals", vendor.requestWithdrawal);

router.get("/settlements", vendor.getMySettlements);

// Support tickets for the vendor's own machines
router.get("/tickets", tickets.list);
router.post("/tickets", tickets.create);
router.get("/tickets/:ticketId", tickets.get);
router.post("/tickets/:ticketId/updates", tickets.update);

module.exports = router;