// src/services/machine.service.js
// Per-machine settings (module, login) and Module 2 printer routing.
const crypto = require("crypto");
const db = require("../database/db");
const env = require("../config/env");
const { STRICT_SEGMENTS } = require("./org.service");

const MODULES = ["KIOSK", "SHOP"];
const JOB_TYPES = ["PRINT", "FORM", "COPY", "SCAN"];
const MANUAL_JOB_TYPES = new Set(["COPY", "SCAN"]); // done by hand / at the device, no uploaded file
const LANGUAGES = ["en", "hi", "mr"];
const ONLINE_WINDOW_SECONDS = 120; // device / printer counts as online if seen in the last 2 min

function parseJobTypes(value) {
  const list = String(value || "PRINT,FORM").split(",").map((s) => s.trim().toUpperCase()).filter((s) => JOB_TYPES.includes(s));
  return list.length ? JOB_TYPES.filter((t) => list.includes(t)) : ["PRINT"];
}

/* Everything the print flow needs to know about a machine in one query:
   module, vendor, organisation, contract, segment and privacy mode. */
async function getContext(machineId, conn = db) {
  const [[m]] = await conn.query(
    `SELECT m.*,
            v.segment AS vendor_segment, v.strict_privacy AS vendor_strict_privacy, v.status AS vendor_status,
            o.name AS org_name, o.segment AS org_segment, o.office_code, o.default_language AS org_language,
            c.contract_type, c.status AS contract_status, c.revenue_share_pct,
            l.name AS location_name, l.city, l.state AS location_state
     FROM machines m
     LEFT JOIN vendors v ON v.id = m.owner_vendor_id
     LEFT JOIN organizations o ON o.id = m.organization_id
     LEFT JOIN contracts c ON c.id = m.contract_id
     LEFT JOIN locations l ON l.id = m.location_id
     WHERE m.machine_id=?`,
    [machineId]
  );
  if (!m) return null;
  const segment = m.org_segment || m.vendor_segment || "EDUCATION";
  const strictPrivacy =
    m.org_segment === "GOVERNMENT" || m.org_segment === "PSU" ||   // offices always strict
    m.vendor_strict_privacy === 1 ||
    (m.vendor_strict_privacy !== 0 && STRICT_SEGMENTS.has(segment));
  return {
    ...m,
    segment,
    strictPrivacy,
    jobTypes: parseJobTypes(m.enabled_job_types),
    language: m.default_language || m.org_language || null,
    // Contract only counts while it is active
    activeContractId: m.contract_id && m.contract_status === "ACTIVE" ? m.contract_id : null,
  };
}

const isRecent = (date, seconds = ONLINE_WINDOW_SECONDS) =>
  !!date && (Date.now() - new Date(date).getTime()) / 1000 < seconds;

async function getMachine(machineId, conn = db) {
  const [[m]] = await conn.query(`SELECT * FROM machines WHERE machine_id=?`, [machineId]);
  return m || null;
}

/* Machine setting wins; NULL means "use the server default". */
function loginRequired(machine) {
  if (!machine || machine.require_login === null || machine.require_login === undefined) {
    return env.REQUIRE_CUSTOMER_LOGIN;
  }
  return !!machine.require_login;
}

function parseModules(value) {
  const list = String(value || "KIOSK").split(",").map((s) => s.trim().toUpperCase()).filter((s) => MODULES.includes(s));
  return list.length ? [...new Set(list)] : ["KIOSK"];
}

/* ── Module 2: printers ── */

async function listPrinters(machineId, conn = db) {
  const [rows] = await conn.query(
    `SELECT id, machine_id, system_name, display_name, kind, supports_duplex, paper_sizes,
            status, status_message, is_enabled, last_seen_at
     FROM printers WHERE machine_id=? ORDER BY kind DESC, display_name`,
    [machineId]
  );
  return rows.map((p) => ({
    ...p,
    supports_duplex: !!p.supports_duplex,
    is_enabled: !!p.is_enabled,
    paper_sizes: String(p.paper_sizes || "A4").split(",").filter(Boolean),
    is_online: p.status === "ONLINE" && isRecent(p.last_seen_at),
  }));
}

/* Can printer p take a job with these options? */
function printerFits(p, { color, paperSize, printSide }) {
  if (!p.is_enabled) return false;
  if (color === "color" && p.kind !== "COLOR") return false;
  if (paperSize && !p.paper_sizes.includes(paperSize)) return false;
  if (printSide === "duplex" && !p.supports_duplex) return false;
  return true;
}

/* What the customer can choose on a shop machine (enabled printers only).
   For a kiosk, null → the print page shows its normal options. */
async function getCapabilities(machine) {
  if (machine.module !== "SHOP") return null;
  const printers = (await listPrinters(machine.machine_id)).filter((p) => p.is_enabled);
  const agentOnline = isRecent(machine.last_seen_at);
  const usable = printers.filter((p) => agentOnline && p.is_online);

  const sizes = new Set();
  printers.forEach((p) => p.paper_sizes.forEach((s) => sizes.add(s)));

  const describe = (color) => {
    const fits = printers.filter((p) => printerFits(p, { color }));
    return {
      available: fits.length > 0,
      online: fits.some((p) => usable.includes(p)),
      duplex: fits.some((p) => p.supports_duplex),
      paperSizes: [...new Set(fits.flatMap((p) => p.paper_sizes))],
    };
  };

  return {
    bw: describe("bw"),
    color: describe("color"),
    paperSizes: sizes.size ? [...sizes] : ["A4"],
    printers: printers.map((p) => ({
      name: p.display_name, kind: p.kind, online: usable.includes(p),
    })),
  };
}

/* Is this combination printable on the shop at all (ignores online state)? */
async function shopCanPrint(machineId, options) {
  const printers = await listPrinters(machineId);
  return printers.some((p) => printerFits(p, options));
}

/* Pick the printer for a paid shop job: enabled + online + fits the job.
   B&W jobs go to a B&W printer first, then a colour one. Among equals, the
   printer with the fewest jobs in progress wins. Returns null if none fits. */
async function choosePrinter(machineId, job, conn = db) {
  const printers = (await listPrinters(machineId, conn)).filter(
    (p) => p.is_online && printerFits(p, { color: job.color, paperSize: job.paper_size, printSide: job.print_side })
  );
  if (!printers.length) return null;

  const [busy] = await conn.query(
    `SELECT printer_id, COUNT(*) n FROM print_jobs WHERE machine_id=? AND status='PRINTING' GROUP BY printer_id`,
    [machineId]
  );
  const load = Object.fromEntries(busy.map((b) => [b.printer_id, Number(b.n)]));
  const rank = (p) => (job.color === "bw" && p.kind === "BW" ? 0 : 1);
  printers.sort((a, b) => rank(a) - rank(b) || (load[a.id] || 0) - (load[b.id] || 0) || a.id - b.id);
  return printers[0];
}

/* Short pickup code for a shop order: letter + 2 digits ("K47"), unique among
   this shop's open orders. Letters that look like digits are skipped. */
const CODE_LETTERS = "ACDEFHJKLMNPRTUVWXY";
async function newOrderCode(machineId, conn = db) {
  for (let i = 0; i < 30; i++) {
    const code = CODE_LETTERS[crypto.randomInt(CODE_LETTERS.length)] + String(crypto.randomInt(10, 100));
    const [[clash]] = await conn.query(
      `SELECT id FROM print_jobs WHERE machine_id=? AND order_code=?
         AND (status IN ('PAID','PRINTING') OR created_at > NOW() - INTERVAL 1 DAY) LIMIT 1`,
      [machineId, code]
    );
    if (!clash) return code;
  }
  return crypto.randomBytes(3).toString("hex").toUpperCase(); // practically never reached
}

/* ── Device setup codes (both modules) ──
   The admin shows the code once; the device swaps it for its API key. */
const SETUP_CODE_TTL_HOURS = 48;
const SETUP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const hashSetupCode = (code) =>
  crypto.createHash("sha256").update(String(code).replace(/[^A-Z0-9]/gi, "").toUpperCase()).digest("hex");

async function issueSetupCode(machineId) {
  let raw = "";
  for (let i = 0; i < 8; i++) raw += SETUP_ALPHABET[crypto.randomInt(SETUP_ALPHABET.length)];
  const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
  const expires = new Date(Date.now() + SETUP_CODE_TTL_HOURS * 3600 * 1000);
  await db.query(
    `UPDATE machines SET setup_code_hash=?, setup_code_expires_at=? WHERE machine_id=?`,
    [hashSetupCode(code), expires, machineId]
  );
  return { setupCode: code, expiresAt: expires };
}

/* Checked in recently (kiosk heartbeat / shop agent). */
const isOnline = (machine) => !!machine && isRecent(machine.last_seen_at);

module.exports = {
  isOnline,
  MODULES,
  JOB_TYPES,
  MANUAL_JOB_TYPES,
  LANGUAGES,
  parseJobTypes,
  getContext,
  isRecent,
  getMachine,
  loginRequired,
  parseModules,
  listPrinters,
  printerFits,
  getCapabilities,
  shopCanPrint,
  choosePrinter,
  newOrderCode,
  issueSetupCode,
  hashSetupCode,
};
