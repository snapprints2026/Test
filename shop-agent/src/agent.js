// src/agent.js — SnapPrints Shop Print Agent (Module 2).   npm start
//
// Runs on the xerox shop's computer. When a customer pays, the server tells
// this agent ("job_ready"); the agent claims the order, downloads the PDF and
// prints it on the right copier (B&W or colour), then reports back. If a
// print fails twice the order is refunded automatically.
//
// Photocopy (COPY) and scan (SCAN) orders are NOT printed automatically —
// they appear on the shop screen for the shopkeeper to do at the counter
// ("Start" → "Done", or "Upload scan" for scans).
//
// The shopkeeper's screen: http://localhost:7300 (opens on this computer only).
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const { io } = require("socket.io-client");
const { loadConfig } = require("./config");
const { createApi } = require("./api");
const { getStatuses, printPdf } = require("./printers");
const { startScreen } = require("./screen");

const HEARTBEAT_MS = 30000;
const POLL_MS = 15000;
const PRINTER_ERROR_COOLDOWN_MS = 2 * 60 * 1000; // a printer that just failed is skipped for 2 min
const MAX_ATTEMPTS = 2;

const cfg = loadConfig();
if (!cfg) {
  console.error("Not set up yet. Run:  npm run setup");
  process.exit(1);
}
const api = createApi(cfg);
const TMP = path.join(os.tmpdir(), "snapprints-agent");
fs.mkdirSync(TMP, { recursive: true });

/* ── State (also shown on the shop screen) ── */
const state = {
  machineId: cfg.machineId,
  dryRun: !!cfg.dryRun,
  socketConnected: false,
  serverOk: false,
  lastError: null,
  startedAt: new Date().toISOString(),
  printers: cfg.printers.map((p) => ({ ...p, id: null, isEnabled: true, status: "OFFLINE", message: null })),
  current: null,          // { jobId, orderCode, printer, step }
  log: [],                // newest first
};
const attempts = new Map();     // jobId → failed attempts
const announced = new Set();    // manual orders already logged
const MANUAL = new Set(["COPY", "SCAN"]);
const printerErrorUntil = new Map(); // systemName → timestamp

function log(msg, level = "info") {
  const line = { at: new Date().toISOString(), level, msg };
  state.log.unshift(line);
  state.log.length = Math.min(state.log.length, 80);
  (level === "error" ? console.error : console.log)(`[${line.at.slice(11, 19)}] ${msg}`);
}

/* ── Server sync ── */
async function syncPrinters() {
  const res = await api.post("/agent/printers", {
    printers: cfg.printers.map((p) => ({
      systemName: p.systemName, displayName: p.displayName, kind: p.kind, duplex: !!p.duplex, paperSizes: p.paperSizes,
    })),
  });
  for (const sp of res.printers) {
    const local = state.printers.find((p) => p.systemName === sp.system_name);
    if (local) { local.id = sp.id; local.isEnabled = sp.is_enabled; }
  }
  log(`Printers registered with server: ${state.printers.map((p) => p.displayName).join(", ")}`);
}

async function heartbeat() {
  try {
    const statuses = await getStatuses(cfg.printers, cfg.dryRun);
    const now = Date.now();
    for (const s of statuses) {
      if ((printerErrorUntil.get(s.systemName) || 0) > now) {
        s.status = "ERROR";
        s.message = "Last print failed — retrying soon";
      }
      const local = state.printers.find((p) => p.systemName === s.systemName);
      if (local) { local.status = s.status; local.message = s.message || null; }
    }
    const res = await api.post("/agent/heartbeat", { printers: statuses });
    for (const sp of res.printers || []) {
      const local = state.printers.find((p) => p.systemName === sp.systemName);
      if (local) { local.id = sp.id; local.isEnabled = sp.isEnabled; }
    }
    if (!state.serverOk) log("Connected to server");
    state.serverOk = true;
    state.lastError = null;
  } catch (err) {
    if (state.serverOk || !state.lastError) log(`Server unreachable: ${err.message}`, "error");
    state.serverOk = false;
    state.lastError = err.message;
    if (err.status === 401 || err.status === 403) {
      state.lastError = `${err.message} — this computer's key was rejected. Run "npm run setup" with a new setup code.`;
    }
  }
}

/* ── Printing ── */
let running = false;
let again = false;

function kick() {
  if (running) { again = true; return; }
  running = true;
  processQueue()
    .catch((err) => log(`Queue error: ${err.message}`, "error"))
    .finally(() => {
      running = false;
      if (again) { again = false; kick(); }
    });
}

async function processQueue() {
  const { jobs } = await api.get("/agent/jobs/pending");
  for (const job of jobs) {
    if (MANUAL.has(job.job_type)) {
      if (!announced.has(job.job_id)) {
        announced.add(job.job_id);
        log(`New ${job.job_type === "COPY" ? "photocopy" : "scan"} order ${job.order_code}: ${job.total_pages} page(s)` +
          `${job.job_type === "COPY" ? ` × ${job.copies}` : ""} — do it at the counter (shop screen)`);
      }
      continue;
    }
    let claim;
    try {
      claim = await api.post(`/agent/jobs/${encodeURIComponent(job.job_id)}/claim`);
    } catch (err) {
      if (err.status === 409) continue; // no printer free for it right now / already taken
      if (err.status === 410) { log(`Order ${job.order_code}: file missing on server — refunded`, "error"); continue; }
      throw err;
    }
    await printClaimed(claim);
  }
}

async function printClaimed(job) {
  const printer = cfg.printers.find((p) => p.systemName === job.printer.systemName) || job.printer;
  const label = `Order ${job.orderCode} (${job.copies}× ${job.totalPages}p ${job.color === "color" ? "colour" : "B&W"}${job.printSide === "duplex" ? ", duplex" : ""})`;
  state.current = { jobId: job.jobId, orderCode: job.orderCode, printer: printer.displayName || printer.systemName, step: "Downloading" };
  const file = path.join(TMP, `${job.jobId}.pdf`);
  try {
    const res = await fetch(job.downloadUrl, { signal: AbortSignal.timeout(120000) });
    if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
    await fsp.writeFile(file, Buffer.from(await res.arrayBuffer()));

    state.current.step = "Printing";
    log(`${label} → ${printer.displayName || printer.systemName}`);
    await printPdf(file, printer, job, cfg.dryRun);

    await api.post(`/agent/jobs/${encodeURIComponent(job.jobId)}/printed`);
    attempts.delete(job.jobId);
    log(`✓ ${label} printed`);
  } catch (err) {
    const n = (attempts.get(job.jobId) || 0) + 1;
    attempts.set(job.jobId, n);
    printerErrorUntil.set(printer.systemName, Date.now() + PRINTER_ERROR_COOLDOWN_MS);
    log(`✗ ${label} failed on ${printer.displayName || printer.systemName}: ${err.message}`, "error");
    await heartbeat(); // tell the server this printer has a problem before anything else is routed to it
    try {
      if (n >= MAX_ATTEMPTS) {
        await api.post(`/agent/jobs/${encodeURIComponent(job.jobId)}/failed`, { reason: `Print failed: ${err.message}`.slice(0, 200) });
        attempts.delete(job.jobId);
        log(`Order ${job.orderCode} refunded after ${n} failed attempts`, "error");
      } else {
        await api.post(`/agent/jobs/${encodeURIComponent(job.jobId)}/requeue`);
        log(`Order ${job.orderCode} put back in the queue — will retry`);
      }
    } catch (e) {
      log(`Could not report failure for ${job.orderCode}: ${e.message}`, "error");
    }
  } finally {
    state.current = null;
    fsp.unlink(file).catch(() => {});
  }
}

/* ── Live connection: server pushes "job_ready" the moment a customer pays ── */
function connectSocket() {
  const origin = new URL(cfg.apiBase).origin;
  const socket = io(origin, { transports: ["websocket", "polling"], reconnectionDelayMax: 10000 });
  socket.on("connect", () => {
    const h = api.signedHeaders("{}");
    socket.emit("device:join", {
      machineId: h["x-machine-id"], timestamp: h["x-timestamp"], apiKey: h["x-api-key"], signature: h["x-signature"],
    }, (ack) => {
      state.socketConnected = !!(ack && ack.ok);
      if (ack && ack.ok) { log("Live connection ready"); kick(); }
      else log(`Live connection refused: ${ack ? ack.error : "no answer"}`, "error");
    });
  });
  socket.on("disconnect", () => { state.socketConnected = false; log("Live connection lost — still checking every 15 s", "error"); });
  socket.on("job_ready", () => kick());
  socket.on("printers_changed", () => heartbeat());
  return socket;
}

/* ── Start ── */
async function main() {
  console.log(`\nSnapPrints Shop Print Agent — ${cfg.machineId}${cfg.dryRun ? "  [DRY-RUN: nothing is really printed]" : ""}`);
  console.log(`Server: ${cfg.apiBase}\n`);

  for (;;) {
    try {
      await syncPrinters();
      break;
    } catch (err) {
      state.lastError = err.message;
      log(`Could not register printers (${err.message}) — retrying in 10 s`, "error");
      await new Promise((r) => setTimeout(r, 10000));
    }
  }
  await heartbeat();
  startScreen({ cfg, state, api, heartbeat, kick, log });
  connectSocket();
  setInterval(heartbeat, HEARTBEAT_MS);
  setInterval(kick, POLL_MS);
  kick();
}

process.on("unhandledRejection", (err) => log(`Unexpected error: ${err && err.message}`, "error"));
main();
