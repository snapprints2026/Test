// src/routes/job.routes.js — customer orders (owner only)
const express = require("express");
const router = express.Router();
const job = require("../controllers/job.controller");
const issue = require("../controllers/issue.controller");
// customerAuth = attaches the customer if logged in; each machine decides whether login is required
const { customerAuth } = require("../middleware/verifyCustomerToken");
const { rateLimit } = require("../middleware/rateLimit");

const createLimit = rateLimit({ max: 60, windowMinutes: 15, message: "Too many orders from this device. Try again later." });
const pinLimit = rateLimit({ max: 10, windowMinutes: 15, message: "Too many wrong staff codes. Try again in 15 minutes." });

// PRINT: the file goes straight from the phone to storage (see job.controller.js)
router.post ("/upload-url",                    createLimit, customerAuth, job.createUploadUrl);
router.post ("/jobs/:jobId/complete-upload",   customerAuth, job.completeUpload);
// FORM: blank form from the catalogue · COPY / SCAN: done at the machine
router.post ("/form-jobs",                     createLimit, customerAuth, job.createFormJob);
router.post ("/service-jobs",                  createLimit, customerAuth, job.createServiceJob);

// "Didn't get your print?" — customer reports a problem with a paid order (refund queue)
const reportLimit = rateLimit({ max: 10, windowMinutes: 60, message: "Too many reports. Please try again later." });
router.post ("/jobs/:jobId/report", reportLimit, customerAuth, issue.reportIssue);
router.get  ("/job-summary/:jobId",  customerAuth, job.getSummary);
router.patch("/job/:jobId",          customerAuth, job.updateJob);
router.get  ("/job-status/:jobId",   customerAuth, job.getStatus);
router.get  ("/jobs/:jobId/scan",    customerAuth, job.getScanLink);
router.get  ("/jobs/:jobId/receipt", customerAuth, job.getReceipt);
// Department-billed machines: staff code instead of payment
router.post ("/jobs/:jobId/submit-billed", pinLimit, customerAuth, job.submitBilled);

// Old multipart upload (file sent through this server) — replaced by the routes above
router.post ("/upload-job", (req, res) =>
  res.status(410).json({ error: "Please refresh the page and upload again." }));

module.exports = router;
