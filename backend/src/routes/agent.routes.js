// src/routes/agent.routes.js — Module 2 shop computer (Print Agent) endpoints → /api/agent/...
const express = require("express");
const router = express.Router();
const agent = require("../controllers/agent.controller");
const { verifyMachine, requireModule } = require("../middleware/verifyMachine");

router.use(verifyMachine, requireModule("SHOP"));

router.post ("/heartbeat",              agent.heartbeat);
router.post ("/printers",               agent.syncPrinters);
router.patch("/printers/:printerId",    agent.setPrinterEnabled);
router.get  ("/jobs/pending",           agent.pendingJobs);
router.get  ("/jobs/recent",            agent.recentJobs);
router.post ("/jobs/:jobId/claim",      agent.claimJob);
router.post ("/jobs/:jobId/printed",    agent.jobPrinted);
router.post ("/jobs/:jobId/failed",     agent.jobFailed);
router.post ("/jobs/:jobId/requeue",    agent.requeueJob);
router.post ("/jobs/:jobId/start",      agent.startManualJob);   // COPY / SCAN at the counter
router.post ("/jobs/:jobId/scan-url",   agent.scanUrl);          // where to upload a scan

module.exports = router;
