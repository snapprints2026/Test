// src/routes/machine.routes.js — public machine info for the print page
const express = require("express");
const router = express.Router();
const machine = require("../controllers/machine.controller");

router.get("/:machineId/status", machine.getStatus);
router.get("/:machineId/forms", machine.getForms);

module.exports = router;
