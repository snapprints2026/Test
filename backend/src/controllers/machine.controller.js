// src/controllers/machine.controller.js
const db = require("../database/db");
const env = require("../config/env");
const machines = require("../services/machine.service");
const payment = require("../services/payment.service");
const { priceTable } = require("../services/pricing.service");
const { noticeInfo } = require("../services/consent.service");
const { availableForms } = require("./job.controller");

/* GET /api/machines/:machineId/status — public, used by the print page after the QR scan.
   Tells the page which module this machine runs, which services it offers
   (print / forms / photocopy / scan), how it is paid for, the approved rates,
   whether login is needed and (for shops) what the printers support. */
exports.getStatus = async (req, res) => {
  const { machineId } = req.params;

  let machine;
  try {
    machine = await machines.getContext(machineId);
  } catch (err) {
    console.error("STATUS machines query error:", err.message);
    return res.status(500).json({ error: "DB error" });
  }
  if (!machine || !["ACTIVE", "PENDING"].includes(machine.status))
    return res.status(404).json({ error: "Machine not found" });

  let isOnline = false;
  let paperLevel = null;
  try {
    if (machine.module === "SHOP") {
      isOnline = machines.isRecent(machine.last_seen_at);
    } else {
      const [hb] = await db.query(
        `SELECT paper_level, created_at FROM machine_heartbeat_logs
         WHERE machine_id=? ORDER BY created_at DESC LIMIT 1`,
        [machineId]
      );
      if (hb.length) {
        isOnline = machines.isRecent(hb[0].created_at);
        paperLevel = hb[0].paper_level ?? null;
      }
    }
  } catch (err) {
    console.warn("STATUS heartbeat query warn:", err.message);
  }

  let capabilities = null;
  let prices = null;
  let formsCount = 0;
  try {
    capabilities = await machines.getCapabilities(machine);
    prices = await priceTable(machine, machine.jobTypes);
    formsCount = (await availableForms(machine)).length;
  } catch (err) {
    console.warn("STATUS extras warn:", err.message);
  }
  // Only offer forms when there are forms for this machine
  const jobTypes = machine.jobTypes.filter((t) => t !== "FORM" || formsCount > 0);

  return res.json({
    machine_id: machine.machine_id,
    name: machine.name,
    location_name: machine.location_name || null,
    organization_name: machine.org_name || null,
    office_code: machine.office_code || null,
    segment: machine.segment,
    module: machine.module || "KIOSK",
    job_types: jobTypes.length ? jobTypes : ["PRINT"],
    billing_mode: machine.billing_mode || "CUSTOMER",
    default_language: machine.language,
    strict_privacy: !!machine.strictPrivacy,
    require_login: machines.loginRequired(machine),
    require_online: env.REQUIRE_MACHINE_ONLINE, // payment is refused while the machine is offline
    is_active: machine.status === "ACTIVE",
    is_online: isOnline,
    paper_level: paperLevel,
    is_print_locked: !!machine.is_print_locked,
    capabilities,
    price_table: prices,
    forms_count: formsCount,
    privacy: noticeInfo(),
    payment_mode: payment.isMock() ? "mock" : "razorpay",
  });
};

/* GET /api/machines/:machineId/forms — the form catalogue for this machine */
exports.getForms = async (req, res) => {
  try {
    const machine = await machines.getContext(req.params.machineId);
    if (!machine || machine.status !== "ACTIVE") return res.status(404).json({ error: "Machine not found" });
    const forms = await availableForms(machine);
    res.json({
      forms: forms.map((f) => ({
        id: f.id, code: f.code, title: f.title, title_hi: f.title_hi, title_mr: f.title_mr,
        description: f.description, category: f.category, pages: f.page_count,
        defaultCopies: f.default_copies, color: f.color, paperSize: f.paper_size, printSide: f.print_side,
        sourceUrl: f.source_url,
      })),
    });
  } catch (err) {
    console.error("FORMS LIST ERROR:", err);
    res.status(500).json({ error: "Could not load forms" });
  }
};
