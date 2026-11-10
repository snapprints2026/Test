const crypto = require("crypto");
const bcrypt  = require("bcrypt");
const db      = require("../database/db");
const env     = require("../config/env");
const payment = require("../services/payment.service");
const machines = require("../services/machine.service");
const { getIO, machineRoom } = require("../socket/socket");
const { logAudit, audit, actorFromReq } = require("../services/audit.service");
const { refundJob } = require("../services/refund.service");
const { SEGMENTS } = require("../services/org.service");
const { ADMIN_ROLES } = require("../middleware/verifyStaffToken");

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const cleanTime = (v) => (v && TIME_RE.test(String(v)) ? String(v).slice(0, 5) : null);
const cleanDays = (v) => {
  const list = (Array.isArray(v) ? v : String(v || "").split(",")).map((d) => Number(d)).filter((d) => d >= 1 && d <= 7);
  return list.length ? [...new Set(list)].sort().join(",") : null;
};
const parseStrict = (v) => (v === true || v === "true" || v === 1 || v === "1" ? 1 : v === false || v === "false" || v === 0 || v === "0" ? 0 : null);

/* "true"/"false"/"default" (or booleans / null) → 1 / 0 / NULL for machines.require_login */
function parseRequireLogin(v) {
  if (v === true || v === "true" || v === 1 || v === "1") return 1;
  if (v === false || v === "false" || v === 0 || v === "0") return 0;
  return null;
}

const SERVER_API_BASE = env.API_BASE_URL;

/* Who the vendor is. The segment follows from it unless the admin picks one. */
const INSTITUTION_TYPES = ["COLLEGE", "UNIVERSITY", "SCHOOL", "COACHING", "SHOP", "GOVERNMENT_OFFICE", "BANK", "PSU_OFFICE", "OTHER"];
const SEGMENT_FOR_INSTITUTION = { SHOP: "RETAIL", GOVERNMENT_OFFICE: "GOVERNMENT", BANK: "PSU", PSU_OFFICE: "PSU" };

/* ===========================
   DASHBOARD STATS
=========================== */
exports.getStats = async (req, res) => {

  try {
    const [[jobsToday]] = await db.query(`
      SELECT COUNT(*) as total
      FROM print_jobs
      WHERE DATE(created_at)=CURDATE()
    `);

    const [[revenueToday]] = await db.query(`
      SELECT SUM(amount) as total
      FROM print_jobs
      WHERE status='PRINTED'
      AND DATE(created_at)=CURDATE()
    `);

    const [[machinesOnline]] = await db.query(`
      SELECT COUNT(*) as total
      FROM machines
      WHERE last_seen_at > NOW() - INTERVAL 2 MINUTE
    `);

    const [[machinesTotal]] = await db.query(`
      SELECT COUNT(*) as total
      FROM machines
    `);

    const [[openTickets]] = await db.query(
      `SELECT COUNT(*) AS total FROM support_tickets WHERE status NOT IN ('RESOLVED','CLOSED')`
    );
    const [bySegment] = await db.query(`
      SELECT COALESCE(o.segment, v.segment, 'EDUCATION') AS segment, COUNT(DISTINCT m.id) AS machines
      FROM machines m
      LEFT JOIN organizations o ON o.id = m.organization_id
      LEFT JOIN vendors v ON v.id = m.owner_vendor_id
      GROUP BY COALESCE(o.segment, v.segment, 'EDUCATION')
    `);
    res.json({
      jobsToday:      jobsToday.total      || 0,
      revenueToday:   revenueToday.total   || 0,
      machinesOnline: machinesOnline.total || 0,
      machinesTotal:  machinesTotal.total  || 0,
      openTickets:    openTickets.total    || 0,
      machinesBySegment: bySegment,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Dashboard error" });
  }
};

/* ===========================
   MACHINE / LOCATION INPUT HELPERS
   (from the live code: full on-site location, contact, hours, weekly off)
=========================== */
const MODULE_ID_PREFIX = { KIOSK: "SPK", SHOP: "SPS" };
const MACHINE_ID_START = 1001;
const WEEK_DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]; // index+1 = ISO day (open_days)

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);
function badRequest(message) { const e = new Error(message); e.status = 400; return e; }
function notFound(message) { const e = new Error(message); e.status = 404; return e; }
function clean(v, max) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return max ? s.slice(0, max) : s;
}
function parsePincode(v) {
  const s = clean(v);
  if (!s) return null;
  if (!/^\d{6}$/.test(s)) throw badRequest("Pincode must be 6 digits");
  return s;
}
function parsePhone(v, label) {
  const s = clean(v);
  if (!s) return null;
  const compact = s.replace(/[\s-]/g, "");
  if (!/^\+?\d{10,13}$/.test(compact)) throw badRequest(`Invalid ${label}`);
  return compact;
}
function parseCoord(v, min, max, label) {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw badRequest(`Invalid ${label}`);
  return n;
}
function parseTime(v) {
  const s = clean(v);
  if (!s) return null;
  const m = s.match(/^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  if (!m) throw badRequest(`Invalid time "${s}" — use HH:MM`);
  return `${m[1].padStart(2, "0")}:${m[2]}:00`;
}
/* ["SUN"] / "sat,sun" / "Sunday" → "SAT,SUN" */
function parseWeeklyOff(v) {
  if (v === undefined || v === null || v === "") return null;
  const list = (Array.isArray(v) ? v : String(v).split(",")).map((d) => String(d).trim().toUpperCase().slice(0, 3)).filter(Boolean);
  const bad = list.find((d) => !WEEK_DAYS.includes(d));
  if (bad) throw badRequest(`Invalid weekly off day "${bad}"`);
  const ordered = WEEK_DAYS.filter((d) => list.includes(d));
  return ordered.length ? ordered.join(",") : null;
}
/* open_days ("1,2,3,4,5,6") and weekly_off ("SUN") describe the same thing; keep both in step. */
const weeklyOffToOpenDays = (off) => {
  const offSet = new Set(String(off || "").split(",").filter(Boolean));
  return WEEK_DAYS.map((d, i) => (offSet.has(d) ? null : i + 1)).filter(Boolean).join(",") || null;
};
const openDaysToWeeklyOff = (days) => {
  const on = new Set(String(days || "").split(",").map(Number));
  return WEEK_DAYS.filter((d, i) => !on.has(i + 1)).join(",") || null;
};
function parseDate(v) {
  const s = clean(v);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw badRequest("Installation date must be YYYY-MM-DD");
  return s;
}

// request-body key → [locations column, parser]
const LOCATION_INPUTS = {
  locationName: ["name",          (v) => clean(v, 200)],
  campusName:   ["campus_name",   (v) => clean(v, 150)],
  building:     ["building",      (v) => clean(v, 100)],
  floor:        ["floor",         (v) => clean(v, 50)],
  spot:         ["spot",          (v) => clean(v, 150)],
  landmark:     ["landmark",      (v) => clean(v, 200)],
  address:      ["address",       (v) => clean(v, 500)],
  city:         ["city",          (v) => clean(v, 100)],
  state:        ["state",         (v) => clean(v, 100)],
  pincode:      ["pincode",       parsePincode],
  latitude:     ["latitude",      (v) => parseCoord(v, -90, 90, "latitude")],
  longitude:    ["longitude",     (v) => parseCoord(v, -180, 180, "longitude")],
  contactName:  ["contact_name",  (v) => clean(v, 120)],
  contactPhone: ["contact_phone", (v) => parsePhone(v, "on-site contact phone")],
  openTime:     ["open_time",     parseTime],
  closeTime:    ["close_time",    parseTime],
  weeklyOff:    ["weekly_off",    parseWeeklyOff],
  openDays:     ["open_days",     (v) => cleanDays(v)],
};
// request-body key → [machines column, parser]
const MACHINE_INPUTS = {
  printerModel: ["printer_model", (v) => clean(v, 120)],
  installedAt:  ["installed_at",  parseDate],
  assetTag:     ["asset_tag",     (v) => clean(v, 60)],
};
function readFields(body, spec, { onlyPresent }) {
  const out = {};
  for (const [key, [column, parse]] of Object.entries(spec)) {
    if (onlyPresent && !has(body, key)) continue;
    out[column] = parse(body[key]);
  }
  // Keep open_days (used for SLA) and weekly_off (shown in the dashboard) in step.
  if (spec === LOCATION_INPUTS) {
    if (has(out, "weekly_off") && !has(body, "openDays")) out.open_days = out.open_time || out.weekly_off ? weeklyOffToOpenDays(out.weekly_off) : null;
    else if (has(out, "open_days") && !has(body, "weeklyOff")) out.weekly_off = openDaysToWeeklyOff(out.open_days);
  }
  return out;
}

/* "ABC College · Main Campus · Block B, Ground floor · Library entrance" */
function buildLocationLabel(r) {
  const where = [r.building, r.floor].filter(Boolean).join(", ");
  let inside = [r.campus_name, where, r.spot].filter(Boolean);
  if (!inside.length && r.location_name) inside = [r.location_name];
  const parts = [r.vendor_name, ...inside].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/* Machine IDs: SP + K (kiosk) / S (shop computer) + number — SPK1001, SPS1001 …
   Each type counts on its own. Older IDs (MH1000 …) are kept as they are. */
async function nextMachineId(conn, module) {
  const prefix = MODULE_ID_PREFIX[module] || MODULE_ID_PREFIX.KIOSK;
  const [[row]] = await conn.query(
    `SELECT MAX(CAST(SUBSTRING(machine_id, ?) AS UNSIGNED)) AS n FROM machines WHERE machine_id REGEXP ?`,
    [prefix.length + 1, `^${prefix}[0-9]+$`]
  );
  const n = row && row.n ? Number(row.n) + 1 : MACHINE_ID_START;
  return prefix + String(n).padStart(4, "0");
}

/* Services a new machine offers by default, by segment (see the segments document):
   Education — print (+ photo of card); Retail — print, photocopy & scan by the shopkeeper;
   Government / PSU — print and forms (photocopy / scan only where staff are present). */
const DEFAULT_JOB_TYPES = {
  EDUCATION: ["PRINT"],
  RETAIL: ["PRINT", "COPY", "SCAN"],
  GOVERNMENT: ["PRINT", "FORM"],
  PSU: ["PRINT", "FORM"],
};

/* ===========================
   CREATE MACHINE
   Body (all optional): vendorId, module ('KIOSK' | 'SHOP'), name,
     campusName, building, floor, spot, landmark, locationName,
     address, city, state, pincode, latitude, longitude,
     contactName, contactPhone, openTime, closeTime, weeklyOff | openDays,
     printerModel, installedAt, assetTag,
     requireLogin, organizationId, contractId, enabledJobTypes
   Location + machine are written in one transaction; the machine ID is
   retried if two admins create a machine at the same moment. The device
   gets its API key when it registers with the setup code.
=========================== */
exports.createMachine = async (req, res) => {
  try {
    const body = { ...(req.body || {}) };
    if (!body.locationName && body.location) body.locationName = body.location;

    const locationFields = readFields(body, LOCATION_INPUTS, { onlyPresent: false });
    const machineFields  = readFields(body, MACHINE_INPUTS,  { onlyPresent: false });
    const module = String(body.module || "KIOSK").trim().toUpperCase();
    if (!machines.MODULES.includes(module)) throw badRequest("module must be KIOSK or SHOP");
    const name = clean(body.name, 150);
    if ((locationFields.open_time && !locationFields.close_time) || (!locationFields.open_time && locationFields.close_time))
      throw badRequest("Give both opening and closing time, or neither");

    let vendor = null;
    if (body.vendorId) {
      const [[v]] = await db.query(
        `SELECT id, full_name, business_name, allowed_modules, status, segment FROM vendors WHERE id=?`, [body.vendorId]
      );
      if (!v) throw notFound("Vendor not found");
      if (v.status !== "ACTIVE") throw badRequest("This vendor is not active");
      if (!machines.parseModules(v.allowed_modules).includes(module))
        throw badRequest(`This vendor is not set up for the ${module === "SHOP" ? "Shop computer" : "Kiosk"} module`);
      vendor = v;
    }
    let org = null;
    if (body.organizationId) {
      [[org]] = await db.query(`SELECT id, segment FROM organizations WHERE id=?`, [body.organizationId]);
      if (!org) throw notFound("Organisation not found");
    }
    if (body.contractId) {
      const [[c]] = await db.query(`SELECT id FROM contracts WHERE id=?`, [body.contractId]);
      if (!c) throw notFound("Contract not found");
    }
    const segment = (org && org.segment) || (vendor && vendor.segment) || "EDUCATION";
    const rawTypes = Array.isArray(body.enabledJobTypes) ? body.enabledJobTypes.join(",") : body.enabledJobTypes;
    const jobTypes = rawTypes ? machines.parseJobTypes(rawTypes) : DEFAULT_JOB_TYPES[segment] || ["PRINT"];

    if (!locationFields.name) {
      const where = [locationFields.spot, locationFields.building].filter(Boolean).join(", ");
      locationFields.name = clean(where, 200) || `${name || "Machine"} Location`;
    }

    for (let attempt = 1; ; attempt++) {
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();
        const cols = Object.keys(locationFields); // fixed list, never from the client
        const [loc] = await conn.query(
          `INSERT INTO locations (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
          cols.map((c) => locationFields[c])
        );
        const machineId = await nextMachineId(conn, module);
        await conn.query(
          `INSERT INTO machines (machine_id, name, module, require_login, location_id, owner_vendor_id, organization_id,
             contract_id, enabled_job_types, printer_model, installed_at, asset_tag, status, assigned)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', FALSE)`,
          [machineId, name || machineId, module, parseRequireLogin(body.requireLogin), loc.insertId,
           vendor ? vendor.id : null, org ? org.id : null, body.contractId || null, jobTypes.join(","),
           machineFields.printer_model, machineFields.installed_at, machineFields.asset_tag]
        );
        await conn.commit();

        const { setupCode, expiresAt } = await machines.issueSetupCode(machineId);
        await audit(req, "MACHINE_CREATED", { machineId, details: { module, vendorId: vendor ? vendor.id : null, organizationId: org ? org.id : null } });
        return res.json({
          success: true,
          message: "Machine created successfully",
          machineId,
          module,
          machine: {
            machine_id: machineId,
            module,
            location_label: buildLocationLabel({ ...locationFields, location_name: locationFields.name, vendor_name: vendor ? vendor.business_name || vendor.full_name : null }),
          },
          setup: { MACHINE_ID: machineId, SETUP_CODE: setupCode, EXPIRES_AT: expiresAt, API_BASE: SERVER_API_BASE },
        });
      } catch (err) {
        await conn.rollback().catch(() => {});
        const idClash = err.code === "ER_DUP_ENTRY" && /machine_id/.test(err.message || "");
        if (idClash && attempt < 5) continue;
        throw err;
      } finally {
        conn.release();
      }
    }
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, error: err.message });
    console.error("CREATE MACHINE ERROR:", err);
    res.status(500).json({ success: false, error: "Failed to create machine" });
  }
};

/* ===========================
   UPDATE MACHINE — partial: only the fields present in the body change.
   Vendor changes go through assign / unassign; government settings through
   PATCH /machines/:id/settings.
=========================== */
exports.updateMachine = async (req, res) => {
  const conn = await db.getConnection();
  try {
    const { machineId } = req.params;
    const body = { ...(req.body || {}) };
    if (!has(body, "locationName") && has(body, "location")) body.locationName = body.location;

    const locationFields = readFields(body, LOCATION_INPUTS, { onlyPresent: true });
    const machineFields  = readFields(body, MACHINE_INPUTS,  { onlyPresent: true });
    if (has(body, "name")) machineFields.name = clean(body.name, 150);

    await conn.beginTransaction();
    const [[machine]] = await conn.query(
      `SELECT machine_id, module, location_id FROM machines WHERE machine_id=? FOR UPDATE`, [machineId]
    );
    if (!machine) throw notFound("Machine not found");
    if (has(body, "module") && String(body.module).toUpperCase() !== (machine.module || "KIOSK"))
      throw badRequest("A machine's type can't be changed because it is part of the machine ID. Create a new machine of the other type instead.");
    if (has(machineFields, "name") && !machineFields.name) machineFields.name = machine.machine_id;

    const locCols = Object.keys(locationFields);
    if (locCols.length) {
      if (machine.location_id) {
        await conn.query(`UPDATE locations SET ${locCols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`,
          [...locCols.map((c) => locationFields[c]), machine.location_id]);
      } else {
        const [r] = await conn.query(`INSERT INTO locations (${locCols.join(", ")}) VALUES (${locCols.map(() => "?").join(", ")})`,
          locCols.map((c) => locationFields[c]));
        machineFields.location_id = r.insertId;
      }
    }
    const mCols = Object.keys(machineFields);
    if (mCols.length) {
      await conn.query(`UPDATE machines SET ${mCols.map((c) => `${c} = ?`).join(", ")} WHERE machine_id = ?`,
        [...mCols.map((c) => machineFields[c]), machineId]);
    }
    await conn.commit();
    await audit(req, "MACHINE_UPDATED", { machineId, details: { fields: [...locCols, ...mCols] } });
    res.json({ success: true, message: "Machine updated successfully" });
  } catch (err) {
    await conn.rollback().catch(() => {});
    if (err.status) return res.status(err.status).json({ success: false, error: err.message, message: err.message });
    console.error("UPDATE MACHINE ERROR:", err);
    res.status(500).json({ success: false, error: "Unable to update machine", message: "Unable to update machine" });
  } finally {
    conn.release();
  }
};

/* ===========================
   DELETE MACHINE
=========================== */

exports.deleteMachine = async (req, res) => {

  const connection = await db.getConnection();

  try {

    await connection.beginTransaction();

    const { machineId } = req.params;

    const [[machine]] = await connection.query(
      `
      SELECT location_id
      FROM machines
      WHERE machine_id=?
      `,
      [machineId]
    );

    if (!machine) {

      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Machine not found",
      });

    }

    const [[jobs]] = await connection.query(
      `
      SELECT COUNT(*) total
      FROM print_jobs
      WHERE machine_id=?
      `,
      [machineId]
    );

    if (jobs.total > 0) {

      await connection.rollback();

      return res.status(400).json({
        success: false,
        message:
          "Cannot delete machine because print jobs exist.",
      });

    }

    await connection.query(
      `
      DELETE FROM machines
      WHERE machine_id=?
      `,
      [machineId]
    );

    await connection.query(
      `
      DELETE FROM locations
      WHERE id=?
      `,
      [machine.location_id]
    );

    await connection.commit();

    res.json({
      success: true,
      message: "Machine deleted successfully",
    });

  } catch (err) {

    await connection.rollback();

    console.error(err);

    res.status(500).json({
      success: false,
      message: "Delete failed",
    });

  } finally {

    connection.release();

  }
};
/* ===========================
   MACHINES LIST
=========================== */
exports.getMachines = async (req, res) => {
  try {
    const [machines] = await db.query(`
      SELECT machine_id, last_seen_at, is_print_locked
      FROM machines
    `);
    res.json(machines);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch machines" });
  }
};

/* ===========================
   ALERTS
=========================== */
exports.getAlerts = async (req, res) => {
  try {
    const [alerts] = await db.query(`
      SELECT *
      FROM machine_alerts
      WHERE is_resolved=FALSE
      ORDER BY created_at DESC
    `);
    res.json(alerts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch alerts" });
  }
};

/* ===========================
   LIVE JOBS
=========================== */
exports.getLiveJobs = async (req, res) => {
  try {
    const [jobs] = await db.query(`
      SELECT job_id, machine_id, status, created_at
      FROM print_jobs
      WHERE status IN ('CREATED','PAYING','PAID','PRINTING')
      ORDER BY created_at DESC
      LIMIT 20
    `);
    res.json(jobs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch live jobs" });
  }
};

/* ===========================
   REVENUE CHART
=========================== */
exports.getRevenue = async (req, res) => {
  try {
    const { period = "week" } = req.query;

    let condition = "";

    switch (period) {
      case "today":
        condition = "DATE(created_at)=CURDATE()";
        break;

      case "week":
        condition = "created_at >= CURDATE() - INTERVAL 6 DAY";
        break;

      case "month":
        condition = "created_at >= CURDATE() - INTERVAL 30 DAY";
        break;

      case "year":
        condition = "created_at >= CURDATE() - INTERVAL 12 MONTH";
        break;

      default:
        condition = "created_at >= CURDATE() - INTERVAL 6 DAY";
    }

    const [rows] = await db.query(`
      SELECT
        DATE(created_at) AS day,
        SUM(amount) AS revenue
      FROM print_jobs
      WHERE
        status='PRINTED'
        AND ${condition}
      GROUP BY DATE(created_at)
      ORDER BY day ASC
    `);

    res.json(rows);

  } catch (err) {

    console.error(err);

    res.status(500).json({
      success:false,
      message:"Revenue fetch failed"
    });

  }
};

/* ===========================
   MACHINE INFO
=========================== */
exports.getMachineInfo = async (req, res) => {
  try {
    const [machines] = await db.query(`
SELECT
    m.machine_id,
    m.name,
    m.module,
    m.require_login,
    m.status,
    m.is_print_locked,
    m.last_seen_at,
    m.device_name,
    m.owner_vendor_id,
    m.organization_id,
    m.contract_id,
    m.enabled_job_types,
    m.billing_mode,
    MAX(v.full_name) AS vendor_name,
    MAX(v.segment) AS vendor_segment,
    MAX(o.name) AS organization_name,
    MAX(o.segment) AS organization_segment,
    MAX(c.contract_no) AS contract_no,
    (SELECT COUNT(*) FROM printers pr WHERE pr.machine_id = m.machine_id) AS printer_count,

    l.name AS location_name,
    l.address,
    l.city,
    l.state,
    l.pincode,
    l.campus_name, l.building, l.floor, l.spot, l.landmark, l.latitude, l.longitude,
    l.contact_name, l.contact_phone, l.weekly_off,
    TIME_FORMAT(l.open_time, '%H:%i') AS open_time, TIME_FORMAT(l.close_time, '%H:%i') AS close_time,
    m.printer_model, DATE_FORMAT(m.installed_at, '%Y-%m-%d') AS installed_at,
    MAX(v.business_name) AS vendor_business_name,

    COUNT(p.id) AS total_jobs,
    COALESCE(SUM(p.amount),0) AS revenue

FROM machines m

LEFT JOIN locations l
ON m.location_id = l.id

LEFT JOIN vendors v
ON v.id = m.owner_vendor_id

LEFT JOIN organizations o
ON o.id = m.organization_id

LEFT JOIN contracts c
ON c.id = m.contract_id

LEFT JOIN print_jobs p
ON p.machine_id = m.machine_id
AND p.status='PRINTED'

GROUP BY m.id

ORDER BY m.created_at DESC
`);

    const now = Date.now();

    const result = machines.map((m) => {
      let isOnline = false;
      if (m.last_seen_at) {
        const diff = (now - new Date(m.last_seen_at).getTime()) / 1000;
        isOnline = diff < 120;
      }
      const location_label = buildLocationLabel({ ...m, vendor_name: m.vendor_business_name || m.vendor_name });
      return { ...m, location_label, is_online: isOnline };
    });

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch machine info" });
  }
};

/* ===========================
   MACHINE REPORT
=========================== */
exports.machineReport = async (req, res) => {
  try {
    const { machineId } = req.params;
    const { period }    = req.query;

    // Whitelist interval to prevent any SQL injection
    const intervalMap = { "1": "1 MONTH", "3": "3 MONTH", "6": "6 MONTH", "12": "1 YEAR" };
    const interval = intervalMap[period] || "1 MONTH";

    const [rows] = await db.query(`
      SELECT
        DATE(created_at) as date,
        SUM(amount) as revenue
      FROM print_jobs
      WHERE machine_id = ?
        AND status = 'PRINTED'
        AND created_at > NOW() - INTERVAL ${interval}
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `, [machineId]);

    res.json(rows);
  } catch (err) {
    console.error("REPORT ERROR:", err);
    res.status(500).json({ error: "Failed to generate report" });
  }
};

/* ===========================
   CREATE VENDOR
   Admin sets an initial password directly (no self-signup for vendors).
=========================== */
exports.createVendor = async (req, res) => {
  try {
    const {
      fullName, email, phone, businessName, gstNumber, password, allowedModules, segment, strictPrivacy, address, state,
      contactDesignation, altPhone, institutionType, panNumber, billingAddress,
    } = req.body;
    if (!fullName || !email || !password) return res.status(400).json({ error: "fullName, email and password are required" });

    const type = String(institutionType || "COLLEGE").trim().toUpperCase();
    if (!INSTITUTION_TYPES.includes(type)) return res.status(400).json({ error: "Invalid institution type" });
    const seg = SEGMENTS.includes(String(segment || "").toUpperCase()) ? String(segment).toUpperCase() : SEGMENT_FOR_INSTITUTION[type] || "EDUCATION";

    const pan = clean(panNumber);
    if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan.toUpperCase())) return res.status(400).json({ error: "Invalid PAN (format: ABCDE1234F)" });
    const gst = clean(gstNumber);
    if (gst && !/^[0-9]{2}[A-Z0-9]{13}$/.test(gst.toUpperCase())) return res.status(400).json({ error: "Invalid GST number (15 characters)" });
    const modules = machines.parseModules(Array.isArray(allowedModules) ? allowedModules.join(",") : allowedModules);
    let cleanPhone, cleanAltPhone;
    try {
      cleanPhone = parsePhone(phone, "phone");
      cleanAltPhone = parsePhone(altPhone, "alternate phone");
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    const cleanEmail = email.trim().toLowerCase();
    const [[existing]] = await db.query(`SELECT id FROM vendors WHERE email=?`, [cleanEmail]);
    if (existing) return res.status(409).json({ error: "A vendor with this email already exists" });
    const hash = await bcrypt.hash(password, 10);
    const billing = clean(billingAddress, 500) || clean(address, 500);

    const [result] = await db.query(
      `INSERT INTO vendors (full_name, contact_designation, email, phone, alt_phone, password_hash, business_name,
         institution_type, gst_number, pan_number, billing_address, address, state, allowed_modules, segment, strict_privacy, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
      [fullName.trim(), clean(contactDesignation, 100), cleanEmail, cleanPhone, cleanAltPhone, hash, clean(businessName, 200),
       type, gst ? gst.toUpperCase() : null, pan ? pan.toUpperCase() : null, billing, billing, clean(state, 100),
       modules.join(","), seg, parseStrict(strictPrivacy)]
    );
    await audit(req, "VENDOR_CREATED", { details: { vendorId: result.insertId, segment: seg } });
    res.json({
      success: true,
      vendor: { id: result.insertId, fullName, email: cleanEmail, businessName: clean(businessName, 200), institutionType: type, allowedModules: modules, segment: seg },
    });
  } catch (err) {
    console.error("CREATE VENDOR ERROR:", err);
    res.status(500).json({ error: "Failed to create vendor" });
  }
};

/* ===========================
   LIST VENDORS — machine count + lifetime revenue per vendor
=========================== */
exports.getVendors = async (req, res) => {
  try {
    const [vendors] = await db.query(`
      SELECT
        v.id, v.full_name, v.email, v.phone, v.business_name, v.gst_number, v.allowed_modules, v.segment,
        v.strict_privacy, v.status, v.created_at, v.institution_type, v.contact_designation, v.alt_phone, v.pan_number,
        COUNT(DISTINCT m.id) AS machine_count,
        COALESCE(SUM(CASE WHEN p.status='PRINTED' THEN p.amount ELSE 0 END), 0) AS total_revenue
      FROM vendors v
      LEFT JOIN machines m ON m.owner_vendor_id = v.id
      LEFT JOIN print_jobs p ON p.machine_id = m.machine_id
      GROUP BY v.id
      ORDER BY v.created_at DESC
    `);
    res.json(vendors);
  } catch (err) {
    console.error("GET VENDORS ERROR:", err);
    res.status(500).json({ error: "Failed to fetch vendors" });
  }
};

/* ===========================
   VENDOR DETAIL — admin drill-down view of one vendor
=========================== */
exports.getVendorDetail = async (req, res) => {
  try {
    const { vendorId } = req.params;

    const [[vendor]] = await db.query(
      `SELECT id, full_name, email, phone, business_name, gst_number, address, state, allowed_modules, segment,
              strict_privacy, status, created_at, institution_type, contact_designation, alt_phone, pan_number, billing_address
       FROM vendors WHERE id=?`,
      [vendorId]
    );
    if (!vendor) return res.status(404).json({ error: "Vendor not found" });

    const [machines] = await db.query(`
      SELECT m.machine_id, m.name, m.module, m.status, m.last_seen_at,
        COUNT(p.id) AS total_prints,
        COALESCE(SUM(CASE WHEN p.status='PRINTED' THEN p.amount ELSE 0 END), 0) AS revenue
      FROM machines m
      LEFT JOIN print_jobs p ON p.machine_id = m.machine_id AND p.status='PRINTED'
      WHERE m.owner_vendor_id = ?
      GROUP BY m.id
    `, [vendorId]);

    const [[bank]] = await db.query(
      `SELECT * FROM bank_accounts WHERE vendor_id=? ORDER BY id DESC LIMIT 1`, [vendorId]
    );

    res.json({ vendor, machines, bank: bank || null });
  } catch (err) {
    console.error("GET VENDOR DETAIL ERROR:", err);
    res.status(500).json({ error: "Failed to fetch vendor detail" });
  }
};

/* ===========================
   LIST CUSTOMERS
   Includes a quick "needs attention" signal per customer so the admin
   can scan the list without opening every profile:
   - problem_jobs: paid-but-never-verified (EXPIRED) or explicitly FAILED
   - stuck_jobs: OTP verified (PRINTING) but no print/fail confirmation
     in 15+ minutes — usually means the machine hung or jammed.
=========================== */
exports.getCustomers = async (req, res) => {
  try {
    const [customers] = await db.query(`
      SELECT c.id, c.name, c.phone, c.created_at,
        COUNT(p.id) AS total_orders,
        COALESCE(SUM(CASE WHEN p.status='PRINTED' THEN p.amount ELSE 0 END), 0) AS total_spent,
        SUM(CASE WHEN p.status IN ('EXPIRED','FAILED') THEN 1 ELSE 0 END) AS problem_jobs,
        SUM(CASE WHEN p.status='PRINTING' AND p.updated_at < NOW() - INTERVAL 15 MINUTE THEN 1 ELSE 0 END) AS stuck_jobs
      FROM customers c
      LEFT JOIN print_jobs p ON p.customer_id = c.id
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `);
    res.json(customers);
  } catch (err) {
    console.error("GET CUSTOMERS ERROR:", err);
    res.status(500).json({ error: "Failed to fetch customers" });
  }
};

/* ===========================
   CUSTOMER DETAIL — full print job history across every machine
   they've used, with a computed `flag` per job so the admin can spot
   refund/investigation candidates at a glance:
     - PAID_NOT_VERIFIED : payment succeeded but OTP was never entered
                            before it expired (cron already marks these
                            EXPIRED — see the cleanup job in server.js)
     - STUCK_PRINTING     : OTP was verified (job moved to PRINTING) but
                            there's been no PRINTED/FAILED confirmation
                            in 15+ minutes — likely a machine/paper issue
     - FAILED             : explicitly marked failed (refund attempted
                             automatically if a payment_id existed)
=========================== */
exports.getCustomerDetail = async (req, res) => {
  try {
    const { customerId } = req.params;

    const [[customer]] = await db.query(
      `SELECT id, name, phone, created_at FROM customers WHERE id=?`,
      [customerId]
    );
    if (!customer) return res.status(404).json({ error: "Customer not found" });

    const [jobs] = await db.query(`
      SELECT
        pj.job_id, pj.machine_id, m.name AS machine_name,
        pj.file_name, pj.total_pages, pj.copies, pj.color, pj.paper_size, pj.print_side,
        pj.amount, pj.status, pj.payment_id, pj.payment_method, pj.payment_details,
        pj.created_at, pj.updated_at, pj.printed_at,
        pjt.otp_verified, pjt.otp_expires_at, pj.ref_code, pj.refund_status, pj.refund_amount
      FROM print_jobs pj
      LEFT JOIN machines m ON m.machine_id = pj.machine_id
      LEFT JOIN print_job_tokens pjt ON pjt.job_id = pj.job_id
      WHERE pj.customer_id = ?
      ORDER BY pj.created_at DESC
    `, [customerId]);

    const now = Date.now();
    const enrichedJobs = jobs.map((j) => {
      let flag = null;
      // Already refunded (automatically or by an admin) → nothing left to do
      if (j.refund_status && j.refund_status !== "FAILED") {
        flag = "REFUNDED";
      } else if (j.status === "EXPIRED") {
        flag = "PAID_NOT_VERIFIED";
      } else if (j.status === "PRINTING") {
        const sinceUpdate = j.updated_at ? now - new Date(j.updated_at).getTime() : null;
        if (sinceUpdate !== null && sinceUpdate > 15 * 60 * 1000) {
          flag = "STUCK_PRINTING";
        }
      } else if (j.status === "FAILED") {
        flag = "FAILED";
      }

      let paymentDetails = j.payment_details;
      if (typeof paymentDetails === "string") {
        try { paymentDetails = JSON.parse(paymentDetails); } catch { paymentDetails = null; }
      }

      return { ...j, payment_details: paymentDetails, flag };
    });

    res.json({ customer, jobs: enrichedJobs });
  } catch (err) {
    console.error("GET CUSTOMER DETAIL ERROR:", err);
    res.status(500).json({ error: "Failed to fetch customer detail" });
  }
};

/* ===========================
   ASSIGN / UNASSIGN MACHINE
=========================== */
exports.assignMachineToVendor = async (req, res) => {
  try {
    const { machineId } = req.params;
    const { vendorId } = req.body;
    if (!vendorId) return res.status(400).json({ error: "vendorId is required" });

    const [[vendor]] = await db.query(`SELECT id, allowed_modules FROM vendors WHERE id=?`, [vendorId]);
    if (!vendor) return res.status(404).json({ error: "Vendor not found" });
    const machine = await machines.getMachine(machineId);
    if (!machine) return res.status(404).json({ error: "Machine not found" });
    if (!machines.parseModules(vendor.allowed_modules).includes(machine.module))
      return res.status(400).json({ error: `This vendor is not set up for the ${machine.module === "SHOP" ? "Shop computer" : "Kiosk"} module` });

    await db.query(`UPDATE machines SET owner_vendor_id=? WHERE machine_id=?`, [vendorId, machineId]);

    res.json({ success: true });
  } catch (err) {
    console.error("ASSIGN MACHINE ERROR:", err);
    res.status(500).json({ error: "Failed to assign machine" });
  }
};

exports.unassignMachine = async (req, res) => {
  try {
    const { machineId } = req.params;
    const [r] = await db.query(`UPDATE machines SET owner_vendor_id=NULL WHERE machine_id=?`, [machineId]);
    if (!r.affectedRows) return res.status(404).json({ error: "Machine not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("UNASSIGN MACHINE ERROR:", err);
    res.status(500).json({ error: "Failed to unassign machine" });
  }
};

/* ===========================
   WITHDRAWALS — list + approve/reject/mark-paid
=========================== */
exports.getWithdrawals = async (req, res) => {
  try {
    const { status } = req.query; // optional filter: PENDING | APPROVED | REJECTED | PAID
    const params = [];
    let where = "";
    if (status) { where = "WHERE w.status=?"; params.push(status); }

    const [rows] = await db.query(`
      SELECT w.*, v.full_name AS vendor_name, v.email AS vendor_email,
             b.bank_name, b.account_number, b.ifsc, b.verified AS bank_verified, b.changed_at AS bank_changed_at
      FROM withdrawals w
      JOIN vendors v ON v.id = w.vendor_id
      LEFT JOIN bank_accounts b ON b.vendor_id = w.vendor_id
      ${where}
      ORDER BY w.requested_at DESC
    `, params);

    res.json(rows);
  } catch (err) {
    console.error("GET WITHDRAWALS ERROR:", err);
    res.status(500).json({ error: "Failed to fetch withdrawals" });
  }
};

exports.updateWithdrawalStatus = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const { withdrawalId } = req.params;
    const { status, remarks } = req.body; // APPROVED | REJECTED | PAID

    if (!["APPROVED", "REJECTED", "PAID"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    await connection.beginTransaction();

    const [[withdrawal]] = await connection.query(
      `SELECT * FROM withdrawals WHERE id=? FOR UPDATE`, [withdrawalId]
    );
    if (!withdrawal) {
      await connection.rollback();
      return res.status(404).json({ error: "Withdrawal not found" });
    }
    // Only these steps: PENDING → APPROVED / REJECTED, APPROVED → PAID / REJECTED.
    // (Stops a withdrawal being marked PAID twice.)
    const NEXT = { PENDING: ["APPROVED", "REJECTED"], APPROVED: ["PAID", "REJECTED"] };
    if (!(NEXT[withdrawal.status] || []).includes(status)) {
      await connection.rollback();
      return res.status(409).json({ error: `Withdrawal is ${withdrawal.status} — it can't be changed to ${status}` });
    }
    // Money only goes to a bank account an admin has checked.
    if (status !== "REJECTED") {
      const [[bank]] = await connection.query(`SELECT verified FROM bank_accounts WHERE vendor_id=?`, [withdrawal.vendor_id]);
      if (!bank || !bank.verified) {
        await connection.rollback();
        return res.status(409).json({ error: "The vendor's bank account is not verified yet. Verify it on the vendor's page first." });
      }
    }

    await connection.query(
      `UPDATE withdrawals
       SET status=?, remarks=?, approved_at=IF(?='APPROVED', NOW(), approved_at), approved_by=?
       WHERE id=?`,
      [status, remarks || null, status, req.staff.id, withdrawalId]
    );

    // Mark-paid also writes the payout ledger row.
    if (status === "PAID") {
      await connection.query(
        `INSERT INTO payouts (withdrawal_id, amount, status, paid_at) VALUES (?, ?, 'SUCCESS', NOW())`,
        [withdrawalId, withdrawal.amount]
      );
    }

    await connection.commit();
    await audit(req, `WITHDRAWAL_${status}`, { details: { withdrawalId: Number(withdrawalId), amount: withdrawal.amount } });
    res.json({ success: true });
  } catch (err) {
    await connection.rollback();
    console.error("UPDATE WITHDRAWAL ERROR:", err);
    res.status(500).json({ error: "Failed to update withdrawal" });
  } finally {
    connection.release();
  }
};

/* ===========================
   PATCH /api/admin/vendors/:vendorId/bank-account   { verified: true|false }
   An admin checks the vendor's bank details (e.g. a cancelled cheque or a
   ₹1 test transfer) and marks them verified. Withdrawals can only be approved
   or paid to a verified account. Needs the admin's password.
=========================== */
exports.verifyBankAccount = async (req, res) => {
  try {
    const verified = req.body.verified === true || req.body.verified === "true";
    const [[bank]] = await db.query(`SELECT * FROM bank_accounts WHERE vendor_id=?`, [req.params.vendorId]);
    if (!bank) return res.status(404).json({ error: "This vendor has not added a bank account" });
    await db.query(
      `UPDATE bank_accounts SET verified=?, verified_at=IF(?, NOW(), NULL), verified_by=IF(?, ?, NULL) WHERE id=?`,
      [verified ? 1 : 0, verified, verified, req.staff.id, bank.id]
    );
    await audit(req, verified ? "BANK_ACCOUNT_VERIFIED" : "BANK_ACCOUNT_UNVERIFIED", {
      details: { vendorId: Number(req.params.vendorId), bank: bank.bank_name, account: `••••${String(bank.account_number).slice(-4)}`, ifsc: bank.ifsc },
    });
    res.json({ success: true, verified });
  } catch (err) {
    console.error("VERIFY BANK ERROR:", err);
    res.status(500).json({ error: "Could not update bank account" });
  }
};

/* ===========================
   REVENUE OVERVIEW — platform totals + per-vendor breakdown
   (Per-machine breakdown is already covered by your existing getMachineInfo.)
=========================== */
exports.getRevenueOverview = async (req, res) => {
  try {
    const [[totals]] = await db.query(`
      SELECT COALESCE(SUM(amount),0) AS total_revenue, COUNT(*) AS total_prints
      FROM print_jobs WHERE status='PRINTED'
    `);

    const [perVendor] = await db.query(`
      SELECT v.id AS vendor_id, v.full_name AS vendor_name,
        COALESCE(SUM(p.amount),0) AS revenue,
        COUNT(p.id) AS prints
      FROM vendors v
      LEFT JOIN machines m ON m.owner_vendor_id=v.id
      LEFT JOIN print_jobs p ON p.machine_id=m.machine_id AND p.status='PRINTED'
      GROUP BY v.id
      ORDER BY revenue DESC
    `);

    res.json({ totals, perVendor });
  } catch (err) {
    console.error("REVENUE OVERVIEW ERROR:", err);
    res.status(500).json({ error: "Failed to fetch revenue overview" });
  }
};

/* ===========================
   MACHINE JOBS — reverse view of customer detail: which customers
   have used THIS machine, with the same PAID_NOT_VERIFIED /
   STUCK_PRINTING / FAILED flags so problem jobs are visible either
   way you're looking at the data (by customer or by machine).
=========================== */
exports.getMachineJobs = async (req, res) => {
  try {
    const { machineId } = req.params;

    const [[machine]] = await db.query(
      `SELECT m.machine_id, m.name, m.module, m.require_login, m.status, m.last_seen_at, m.device_name,
              m.setup_code_expires_at, m.owner_vendor_id, v.full_name AS vendor_name, v.segment AS vendor_segment,
              m.organization_id, o.name AS organization_name, m.contract_id, c.contract_no, c.contract_type,
              m.enabled_job_types, m.billing_mode, (m.staff_pin_hash IS NOT NULL) AS has_staff_pin,
              m.default_language, m.asset_tag, m.printer_model, m.installed_at, m.is_print_locked,
              l.name AS location_name, l.address, l.city, l.state, l.pincode, l.open_time, l.close_time, l.open_days,
              l.campus_name, l.building, l.floor, l.spot, l.landmark, l.latitude, l.longitude,
              l.contact_name, l.contact_phone, l.weekly_off, v.business_name AS vendor_business_name
       FROM machines m
       LEFT JOIN vendors v ON v.id = m.owner_vendor_id
       LEFT JOIN organizations o ON o.id = m.organization_id
       LEFT JOIN contracts c ON c.id = m.contract_id
       LEFT JOIN locations l ON l.id = m.location_id
       WHERE m.machine_id=?`,
      [machineId]
    );
    if (!machine) return res.status(404).json({ error: "Machine not found" });
    machine.location_label = buildLocationLabel({ ...machine, vendor_name: machine.vendor_business_name || machine.vendor_name });
    machine.is_online = machines.isRecent(machine.last_seen_at);
    machine.setup_code_pending = !!(machine.setup_code_expires_at && new Date(machine.setup_code_expires_at) > new Date());
    delete machine.setup_code_expires_at;
    const printers = machine.module === "SHOP" ? await machines.listPrinters(machineId) : [];

    const [jobs] = await db.query(`
      SELECT
        pj.job_id, pj.job_type, pj.billing, pj.customer_id, c.name AS customer_name, c.phone AS customer_phone,
        pj.file_name, pj.amount, pj.status, pj.payment_id, pj.payment_method, pj.payment_details,
        pj.order_code, pj.fail_reason, pr.display_name AS printer_name,
        pj.ref_code, pj.refund_status, pj.refund_amount,
        pj.created_at, pj.updated_at, pj.printed_at
      FROM print_jobs pj
      LEFT JOIN customers c ON c.id = pj.customer_id
      LEFT JOIN printers pr ON pr.id = pj.printer_id
      WHERE pj.machine_id = ?
      ORDER BY pj.created_at DESC
      LIMIT 500
    `, [machineId]);

    const now = Date.now();
    const enrichedJobs = jobs.map((j) => {
      let flag = null;
      // Already refunded (automatically or by an admin) → nothing left to do
      if (j.refund_status && j.refund_status !== "FAILED") {
        flag = "REFUNDED";
      } else if (j.status === "EXPIRED") {
        flag = "PAID_NOT_VERIFIED";
      } else if (j.status === "PRINTING") {
        const sinceUpdate = j.updated_at ? now - new Date(j.updated_at).getTime() : null;
        if (sinceUpdate !== null && sinceUpdate > 15 * 60 * 1000) {
          flag = "STUCK_PRINTING";
        }
      } else if (j.status === "FAILED") {
        flag = "FAILED";
      }

      let paymentDetails = j.payment_details;
      if (typeof paymentDetails === "string") {
        try { paymentDetails = JSON.parse(paymentDetails); } catch { paymentDetails = null; }
      }

      return { ...j, payment_details: paymentDetails, flag };
    });

    res.json({ machine, printers, jobs: enrichedJobs });
  } catch (err) {
    console.error("GET MACHINE JOBS ERROR:", err);
    res.status(500).json({ error: "Failed to fetch machine jobs" });
  }
};

/* ===========================
   MANUAL REFUND — for jobs that never went through the automatic
   mark-failed→refund flow (e.g. paid but OTP expired unused, or a
   machine that hung mid-print and never called mark-failed). Refunds
   go back to whatever payment method was originally used — Razorpay
   handles that routing automatically, we just call the API.
=========================== */
exports.refundJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    const [[job]] = await db.query(`SELECT job_id, file_path, status FROM print_jobs WHERE job_id=?`, [jobId]);
    if (!job) return res.status(404).json({ error: "Job not found" });
    if (!["PAID", "PRINTING", "PRINTED", "EXPIRED", "FAILED"].includes(job.status))
      return res.status(400).json({ error: `Refunding a job in status ${job.status} isn't supported` });
    const result = await refundJob(jobId, { reason: "ADMIN_MANUAL", adminId: req.staff.id, actor: actorFromReq(req) });
    if (result.alreadyRefunded)
      return res.status(409).json({ error: `Already refunded (${result.refundStatus})`, refundId: result.refundId });
    if (job.file_path) await require("../services/file.service").deleteJobFile(job.job_id, job.file_path, "refunded");
    res.json({ success: true, refundId: result.refundId, refundStatus: result.refundStatus });
  } catch (err) {
    if (!err.status) console.error("REFUND JOB ERROR:", err);
    res.status(err.status || 500).json({ error: err.message || "Refund failed" });
  }
};

/* ===========================
   MODULES — per-machine settings, setup codes, printers, vendor modules
=========================== */

/* PATCH /api/admin/machines/:machineId/settings   { module?, requireLogin? }
   Changing the module is refused while the machine has paid jobs that are not
   finished, so no customer's order gets stuck between the two flows. */
exports.updateMachineSettings = async (req, res) => {
  try {
    const { machineId } = req.params;
    const machine = await machines.getMachine(machineId);
    if (!machine) return res.status(404).json({ error: "Machine not found" });

    const updates = [];
    const params = [];

    if (req.body.module !== undefined) {
      const module = String(req.body.module).toUpperCase();
      if (!machines.MODULES.includes(module)) return res.status(400).json({ error: "module must be KIOSK or SHOP" });
      if (module !== machine.module) {
        const [[open]] = await db.query(
          `SELECT COUNT(*) n FROM print_jobs WHERE machine_id=? AND status IN ('PAYING','PAID','PRINTING')`, [machineId]
        );
        if (open.n > 0)
          return res.status(409).json({ error: `This machine has ${open.n} unfinished order(s). Wait until they are printed or refunded.` });
        if (machine.owner_vendor_id) {
          const [[v]] = await db.query(`SELECT allowed_modules FROM vendors WHERE id=?`, [machine.owner_vendor_id]);
          if (v && !machines.parseModules(v.allowed_modules).includes(module))
            return res.status(400).json({ error: "The vendor of this machine is not set up for that module" });
        }
        updates.push("module=?");
        params.push(module);
      }
    }
    if (req.body.requireLogin !== undefined) {
      updates.push("require_login=?");
      params.push(parseRequireLogin(req.body.requireLogin));
    }
    const b = req.body;
    if (b.organizationId !== undefined) {
      if (b.organizationId) {
        const [[o]] = await db.query(`SELECT id FROM organizations WHERE id=?`, [b.organizationId]);
        if (!o) return res.status(404).json({ error: "Organisation not found" });
      }
      updates.push("organization_id=?"); params.push(b.organizationId || null);
    }
    if (b.contractId !== undefined) {
      if (b.contractId) {
        const [[c]] = await db.query(`SELECT id, organization_id FROM contracts WHERE id=?`, [b.contractId]);
        if (!c) return res.status(404).json({ error: "Contract not found" });
      }
      updates.push("contract_id=?"); params.push(b.contractId || null);
    }
    if (b.enabledJobTypes !== undefined) {
      const list = machines.parseJobTypes(Array.isArray(b.enabledJobTypes) ? b.enabledJobTypes.join(",") : b.enabledJobTypes);
      updates.push("enabled_job_types=?"); params.push(list.join(","));
    }
    if (b.billingMode !== undefined) {
      if (!["CUSTOMER", "DEPARTMENT"].includes(b.billingMode)) return res.status(400).json({ error: "billingMode must be CUSTOMER or DEPARTMENT" });
      if (b.billingMode !== machine.billing_mode) {
        const [[open]] = await db.query(
          `SELECT COUNT(*) n FROM print_jobs WHERE machine_id=? AND status IN ('PAYING','PAID','PRINTING')`, [machineId]
        );
        if (open.n > 0) return res.status(409).json({ error: `Wait until the ${open.n} unfinished order(s) are done.` });
      }
      updates.push("billing_mode=?"); params.push(b.billingMode);
    }
    if (b.staffPin !== undefined) {
      if (b.staffPin && !/^\d{4,8}$/.test(String(b.staffPin))) return res.status(400).json({ error: "Staff code must be 4–8 digits" });
      updates.push("staff_pin_hash=?"); params.push(b.staffPin ? await bcrypt.hash(String(b.staffPin), 10) : null);
    }
    if (b.defaultLanguage !== undefined) {
      updates.push("default_language=?"); params.push(machines.LANGUAGES.includes(b.defaultLanguage) ? b.defaultLanguage : null);
    }
    for (const [key, col, max] of [["assetTag", "asset_tag", 60], ["printerModel", "printer_model", 120]]) {
      if (b[key] !== undefined) { updates.push(`${col}=?`); params.push(b[key] ? String(b[key]).slice(0, max) : null); }
    }
    if (b.installedAt !== undefined) {
      updates.push("installed_at=?"); params.push(/^\d{4}-\d{2}-\d{2}$/.test(String(b.installedAt)) ? b.installedAt : null);
    }
    if (b.status !== undefined) {
      if (!["ACTIVE", "INACTIVE", "DISABLED"].includes(b.status) || machine.status === "PENDING")
        return res.status(400).json({ error: "status must be ACTIVE, INACTIVE or DISABLED (after the device registered)" });
      updates.push("status=?"); params.push(b.status);
    }
    if (b.isPrintLocked !== undefined) { updates.push("is_print_locked=?"); params.push(b.isPrintLocked ? 1 : 0); }

    // Office hours live on the location row (used for SLA uptime).
    if (b.openTime !== undefined || b.closeTime !== undefined || b.openDays !== undefined) {
      const open = cleanTime(b.openTime), close = cleanTime(b.closeTime);
      if ((open && !close) || (!open && close)) return res.status(400).json({ error: "Give both opening and closing time, or neither" });
      let locationId = machine.location_id;
      if (!locationId) {
        const [ins] = await db.query(`INSERT INTO locations (name) VALUES (?)`, [machine.name || machineId]);
        locationId = ins.insertId;
        updates.push("location_id=?"); params.push(locationId);
      }
      const days = open ? cleanDays(b.openDays) : null;
      await db.query(`UPDATE locations SET open_time=?, close_time=?, open_days=?, weekly_off=? WHERE id=?`,
        [open, close, days, days ? openDaysToWeeklyOff(days) : null, locationId]);
      if (!updates.length) {
        await audit(req, "MACHINE_UPDATED", { machineId, details: { openTime: open, closeTime: close, openDays: b.openDays } });
        return res.json({ success: true });
      }
    }
    if (!updates.length) return res.json({ success: true });

    await db.query(`UPDATE machines SET ${updates.join(", ")} WHERE machine_id=?`, [...params, machineId]);
    const logged = { ...req.body };
    if (logged.staffPin !== undefined) logged.staffPin = logged.staffPin ? "(changed)" : "(removed)";
    await audit(req, "MACHINE_UPDATED", { machineId, details: logged });
    res.json({ success: true });
  } catch (err) {
    console.error("UPDATE MACHINE SETTINGS ERROR:", err);
    res.status(500).json({ error: "Could not update settings" });
  }
};

/* POST /api/admin/machines/:machineId/setup-code — new one-time code for (re)installing the device.
   The current device keeps working until a new device registers with the code. */
exports.newSetupCode = async (req, res) => {
  try {
    const { machineId } = req.params;
    const machine = await machines.getMachine(machineId);
    if (!machine) return res.status(404).json({ error: "Machine not found" });
    const { setupCode, expiresAt } = await machines.issueSetupCode(machineId);
    res.json({
      success: true,
      setup: { MACHINE_ID: machineId, SETUP_CODE: setupCode, EXPIRES_AT: expiresAt, API_BASE: SERVER_API_BASE },
    });
  } catch (err) {
    console.error("SETUP CODE ERROR:", err);
    res.status(500).json({ error: "Could not create setup code" });
  }
};

/* PATCH /api/admin/printers/:printerId   { isEnabled?, displayName? } */
exports.updatePrinter = async (req, res) => {
  try {
    const sets = [];
    const params = [];
    if (req.body.isEnabled !== undefined) { sets.push("is_enabled=?"); params.push(req.body.isEnabled ? 1 : 0); }
    if (req.body.displayName) { sets.push("display_name=?"); params.push(String(req.body.displayName).slice(0, 120)); }
    if (!sets.length) return res.json({ success: true });
    const [r] = await db.query(`UPDATE printers SET ${sets.join(", ")} WHERE id=?`, [...params, req.params.printerId]);
    if (!r.affectedRows) return res.status(404).json({ error: "Printer not found" });
    const [[p]] = await db.query(`SELECT machine_id FROM printers WHERE id=?`, [req.params.printerId]);
    if (p) getIO().to(machineRoom(p.machine_id)).emit("printers_changed", {});
    res.json({ success: true });
  } catch (err) {
    console.error("UPDATE PRINTER ERROR:", err);
    res.status(500).json({ error: "Could not update printer" });
  }
};

/* PATCH /api/admin/vendors/:vendorId   { allowedModules?, status? } */
/* For the audit log: { column: { from, to } } for every "col=?" in an UPDATE.
   Passwords are recorded only as "changed". */
function changesFrom(before, sets, params) {
  const out = {};
  let i = 0;
  for (const s of sets) {
    if (!s.endsWith("=?")) continue;
    const col = s.slice(0, -2);
    const to = params[i++];
    if (col === "password_hash") { out.password = "changed"; continue; }
    const from = before[col] === undefined ? null : before[col];
    if (String(from ?? "") !== String(to ?? "")) out[col] = { from, to };
  }
  return out;
}

exports.updateVendor = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const [[vendor]] = await db.query(`SELECT * FROM vendors WHERE id=?`, [vendorId]);
    if (!vendor) return res.status(404).json({ error: "Vendor not found" });

    const sets = [];
    const params = [];
    if (req.body.allowedModules !== undefined) {
      const list = Array.isArray(req.body.allowedModules) ? req.body.allowedModules.join(",") : req.body.allowedModules;
      const modules = machines.parseModules(list);
      const [inUse] = await db.query(
        `SELECT DISTINCT module FROM machines WHERE owner_vendor_id=?`, [vendorId]
      );
      const missing = inUse.map((r) => r.module).filter((m) => !modules.includes(m));
      if (missing.length)
        return res.status(409).json({ error: `This vendor still has ${missing.join(" / ")} machines. Unassign them first.` });
      sets.push("allowed_modules=?");
      params.push(modules.join(","));
    }
    if (req.body.status !== undefined) {
      if (!["ACTIVE", "INACTIVE", "SUSPENDED"].includes(req.body.status))
        return res.status(400).json({ error: "Invalid status" });
      sets.push("status=?");
      params.push(req.body.status);
    }
    if (req.body.segment !== undefined) {
      const seg = String(req.body.segment).toUpperCase();
      if (!SEGMENTS.includes(seg)) return res.status(400).json({ error: `segment must be one of ${SEGMENTS.join(", ")}` });
      sets.push("segment=?");
      params.push(seg);
    }
    if (req.body.strictPrivacy !== undefined) { sets.push("strict_privacy=?"); params.push(parseStrict(req.body.strictPrivacy)); }
    if (req.body.institutionType !== undefined) {
      const t = String(req.body.institutionType).toUpperCase();
      if (!INSTITUTION_TYPES.includes(t)) return res.status(400).json({ error: "Invalid institution type" });
      sets.push("institution_type=?"); params.push(t);
    }
    for (const [key, col, max] of [["businessName", "business_name", 200], ["gstNumber", "gst_number", 20], ["phone", "phone", 20],
      ["address", "address", 500], ["state", "state", 100], ["fullName", "full_name", 150],
      ["contactDesignation", "contact_designation", 100], ["altPhone", "alt_phone", 20], ["panNumber", "pan_number", 10],
      ["billingAddress", "billing_address", 500]]) {
      if (req.body[key] !== undefined) { sets.push(`${col}=?`); params.push(req.body[key] ? String(req.body[key]).slice(0, max) : null); }
    }
    if (req.body.password) {
      if (String(req.body.password).length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
      sets.push("password_hash=?");
      params.push(await bcrypt.hash(String(req.body.password), 10));
      sets.push("token_version=token_version+1"); // logs the vendor out everywhere
    }
    if (!sets.length) return res.json({ success: true });
    await db.query(`UPDATE vendors SET ${sets.join(", ")} WHERE id=?`, [...params, vendorId]);
    await audit(req, "VENDOR_UPDATED", { details: { vendorId: Number(vendorId), changes: changesFrom(vendor, sets, params) } });
    res.json({ success: true });
  } catch (err) {
    console.error("UPDATE VENDOR ERROR:", err);
    res.status(500).json({ error: "Could not update vendor" });
  }
};

/* ===========================
   ADMIN USERS (SUPER_ADMIN only)
=========================== */
exports.getAdminUsers = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, name, email, role, status, last_login_at, created_at FROM admin_users ORDER BY created_at`
    );
    res.json(rows);
  } catch (err) {
    console.error("ADMIN USERS ERROR:", err);
    res.status(500).json({ error: "Failed to load admin users" });
  }
};

exports.createAdminUser = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: "name, email and password are required" });
    if (String(password).length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
    const r = ADMIN_ROLES.includes(role) ? role : "SUPPORT";
    const clean = String(email).trim().toLowerCase();
    const [[existing]] = await db.query(`SELECT id FROM admin_users WHERE email=?`, [clean]);
    if (existing) return res.status(409).json({ error: "An admin with this email already exists" });
    const [result] = await db.query(
      `INSERT INTO admin_users (name, email, password_hash, role, status) VALUES (?, ?, ?, ?, 'ACTIVE')`,
      [String(name).trim(), clean, await bcrypt.hash(String(password), 10), r]
    );
    await audit(req, "ADMIN_USER_CREATED", { details: { adminId: result.insertId, email: clean, role: r } });
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    console.error("CREATE ADMIN USER ERROR:", err);
    res.status(500).json({ error: "Failed to create admin user" });
  }
};

exports.updateAdminUser = async (req, res) => {
  try {
    const id = Number(req.params.adminId);
    const [[target]] = await db.query(`SELECT id, email, role, status FROM admin_users WHERE id=?`, [id]);
    if (!target) return res.status(404).json({ error: "Admin user not found" });
    // Nobody changes their own role or switches themselves off — another SUPER_ADMIN must do it.
    if (id === Number(req.staff.id) && (req.body.role !== undefined || req.body.status !== undefined)) {
      return res.status(403).json({ error: "You can't change your own role or status. Ask another SUPER_ADMIN." });
    }
    const sets = [];
    const params = [];
    if (req.body.role !== undefined) {
      if (!ADMIN_ROLES.includes(req.body.role)) return res.status(400).json({ error: "Invalid role" });
      sets.push("role=?"); params.push(req.body.role);
    }
    if (req.body.status !== undefined) {
      if (!["ACTIVE", "INACTIVE"].includes(req.body.status)) return res.status(400).json({ error: "Invalid status" });
      sets.push("status=?"); params.push(req.body.status);
    }
    if (req.body.password) {
      if (String(req.body.password).length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
      sets.push("password_hash=?"); params.push(await bcrypt.hash(String(req.body.password), 10));
      sets.push("token_version=token_version+1"); // logs them out everywhere
    }
    if (!sets.length) return res.json({ success: true });
    // Never lock everyone out
    const demoting = (req.body.role && req.body.role !== "SUPER_ADMIN") || req.body.status === "INACTIVE";
    if (target.role === "SUPER_ADMIN" && demoting) {
      const [[n]] = await db.query(`SELECT COUNT(*) n FROM admin_users WHERE role='SUPER_ADMIN' AND status='ACTIVE' AND id<>?`, [id]);
      if (!n.n) return res.status(400).json({ error: "Keep at least one active SUPER_ADMIN" });
    }
    await db.query(`UPDATE admin_users SET ${sets.join(", ")} WHERE id=?`, [...params, id]);
    await audit(req, "ADMIN_USER_UPDATED", { details: { adminId: id, email: target.email, changes: changesFrom(target, sets, params) } });
    res.json({ success: true });
  } catch (err) {
    console.error("UPDATE ADMIN USER ERROR:", err);
    res.status(500).json({ error: "Failed to update admin user" });
  }
};

/* GET /api/admin/me → who am I (role decides what the dashboard shows) */
exports.getMe = async (req, res) => {
  const [[a]] = await db.query(`SELECT id, name, email, role FROM admin_users WHERE id=?`, [req.staff.id]);
  res.json(a || null);
};

/* ===========================
   AUDIT LOG — GET /api/admin/audit?actorType&action&machineId&jobId&before&limit
=========================== */
exports.getAuditLogs = async (req, res) => {
  try {
    const where = [];
    const params = [];
    const { actorType, action, machineId, jobId, before } = req.query;
    if (actorType) { where.push("a.actor_type=?"); params.push(actorType); }
    if (action) { where.push("a.action_type LIKE ?"); params.push(`%${String(action).toUpperCase()}%`); }
    if (machineId) { where.push("a.machine_id=?"); params.push(machineId); }
    if (jobId) { where.push("a.job_id=?"); params.push(jobId); }
    if (before) { where.push("a.id < ?"); params.push(Number(before)); }
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const [rows] = await db.query(
      `SELECT a.id, a.machine_id, a.job_id, a.action_type, a.actor_type, a.actor_id, a.ip, a.details, a.created_at,
              CASE a.actor_type
                WHEN 'ADMIN' THEN (SELECT name FROM admin_users WHERE id=a.actor_id)
                WHEN 'VENDOR' THEN (SELECT full_name FROM vendors WHERE id=a.actor_id)
                WHEN 'OFFICER' THEN (SELECT name FROM officers WHERE id=a.actor_id)
                ELSE NULL END AS actor_name
       FROM audit_logs a
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY a.id DESC LIMIT ${limit}`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error("AUDIT LOG LIST ERROR:", err);
    res.status(500).json({ error: "Failed to load audit log" });
  }
};
