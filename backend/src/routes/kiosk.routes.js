// src/routes/kiosk.routes.js — Module 1 Raspberry Pi kiosk endpoints
const express = require("express");
const router = express.Router();
const kiosk = require("../controllers/kiosk.controller");
const { verifyMachine, requireModule } = require("../middleware/verifyMachine");
const kioskOnly = [verifyMachine, requireModule("KIOSK")];

// OLD first boot of a Pi (no signed headers yet)    → /api/register-machine
// (new devices: POST /api/devices/register with a setup code)
router.post("/register-machine", kiosk.registerMachine);

// Signed kiosk requests                             → /api/kiosk/...
router.post("/kiosk/heartbeat",       kioskOnly, kiosk.heartbeat);
router.post("/kiosk/unlock",          kioskOnly, kiosk.unlock);
router.get ("/kiosk/jobs/:jobId/file", kioskOnly, kiosk.downloadJobFile);
router.post("/kiosk/mark-printed",    kioskOnly, kiosk.markPrinted);
router.post("/kiosk/mark-failed",     kioskOnly, kiosk.markFailed);
router.get ("/kiosk/pending-jobs",    kioskOnly, kiosk.pendingJobs);

module.exports = router;
