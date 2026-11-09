// kioskCore.js — SnapPrints kiosk logic (runs in the Electron MAIN process only).
//
// Flow:
//   1. Wait for network.
//   2. If config.json has no machine yet → register:
//        SETUP_CODE in config.json → POST /api/devices/register (recommended:
//        the admin creates the machine and gets a one-time code, valid 48 h)
//        no code → POST /api/register-machine with the Pi's serial (older way,
//        works only while the server has ALLOW_LEGACY_PI_REGISTRATION=true)
//      The MACHINE_ID + API key are saved in config.json.
//   3. Heartbeat every 30s, join our private socket room, poll for paid jobs
//      and pre-download their files so printing is instant.
//   4. Customer types the OTP / scans the QR → unlock →
//        PRINT / FORM (incl. photo-of-card pages): download → print → mark-printed
//        COPY: scan each page on the multifunction printer → print it → Finish
//        SCAN: scan each page → one PDF → upload to the customer → Finish
//      Any error → mark-failed, which refunds the customer automatically.
//   5. Heartbeat reports real paper status from CUPS ("media-empty" → 0 %),
//      so the server stops taking payments while the printer is out of paper.
//
// Customer files live in a private Cloudflare R2 bucket. The kiosk downloads
// them through the short-lived link the backend gives it (downloadUrl), or via
// the signed endpoint GET /api/kiosk/jobs/:jobId/file?format=json.
const axios            = require("axios");
const fs               = require("fs");
const path             = require("path");
const { exec }         = require("child_process");
const crypto           = require("crypto");
const os               = require("os");
const readline         = require("readline");
const dns              = require("dns").promises;
const { io: socketIO } = require("socket.io-client");

/* ===============================
   CONFIG
=============================== */
const IS_PI      = process.platform === "linux";
const IS_WINDOWS = process.platform === "win32";

// Everything lives next to this file (works for any Pi user, not only "pi").
// Override with KIOSK_HOME if you ever need a different folder.
const PROJECT_ROOT = process.env.KIOSK_HOME || __dirname;

const DEFAULT_API_BASE   = "https://snapprintsbackend-production.up.railway.app/api";
const CONFIG_FILE        = path.join(PROJECT_ROOT, "config.json");
const DOWNLOAD_DIR       = path.join(PROJECT_ROOT, "kiosk", "files");
const CACHE_FILE         = path.join(PROJECT_ROOT, "kiosk", "jobs.json");
const HEARTBEAT_INTERVAL = 30000;
const POLL_INTERVAL      = 30000;
const START_RETRY_MS     = 60000;   // retry the whole start-up if it fails (e.g. no free machine yet)
const CACHE_TTL_MS       = 10 * 60 * 1000;

// Errors that mean "couldn't reach the server", NOT "the server rejected us".
const NETWORK_ERROR_CODES = new Set([
  "EAI_AGAIN", "ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "ECONNABORTED",
  "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "ERR_NETWORK",
]);

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/* ===============================
   CONFIG FILE
=============================== */
function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return null;
    const data = fs.readFileSync(CONFIG_FILE, "utf-8").trim();
    if (!data) return null;
    return JSON.parse(data);
  } catch (err) {
    console.error("⚠️  config.json is unreadable, ignoring it:", err.message);
    return null;
  }
}

function saveConfig(updates) {
  const current = loadConfig() || {};
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ ...current, ...updates }, null, 2));
}

// Drop the machine identity but keep the settings that belong to this Pi.
function clearMachineCredentials() {
  const current = loadConfig() || {};
  delete current.MACHINE_ID;
  delete current.API_KEY;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(current, null, 2));
}

// "https://x.app/", "https://x.app" or "https://x.app/api/" → "https://x.app/api"
function normalizeApiBase(url) {
  const trimmed = String(url || "").trim().replace(/\/+$/, "");
  if (!trimmed) return DEFAULT_API_BASE;
  return /\/api$/.test(trimmed) ? trimmed : `${trimmed}/api`;
}

let API_BASE = normalizeApiBase((loadConfig() || {}).API_BASE || DEFAULT_API_BASE);
console.log("🌐 API_BASE:", API_BASE);

/* ===============================
   GLOBALS
=============================== */
let MACHINE_ID    = null;
let API_KEY       = null;
let PRINTER_NAME  = null;
let DEVICE_SERIAL = null;
let fileCache     = {};
let socket        = null;
let ready         = false;
let startupError  = null;

/* ===============================
   NETWORK WAIT
   The Pi needs 5–15 s after boot to get a network.
=============================== */
async function waitForNetwork(maxWaitMs = 90000) {
  const hostname = new URL(API_BASE).hostname;
  const interval = 5000;
  const attempts = Math.ceil(maxWaitMs / interval);

  console.log(`🌐 Waiting for network (DNS: ${hostname})...`);
  for (let i = 1; i <= attempts; i++) {
    try {
      await dns.lookup(hostname);
      console.log(`✅ Network ready (attempt ${i})`);
      return true;
    } catch (err) {
      console.log(`⏳ Network not ready yet (attempt ${i}/${attempts}): ${err.message}`);
      await delay(interval);
    }
  }
  console.error("❌ Network never became available — giving up after", maxWaitMs / 1000, "seconds");
  return false;
}

/* ===============================
   CACHE (pre-downloaded files)
=============================== */
function safeDelete(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch {}
  }
}

function saveCache() {
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify(fileCache, null, 2)); }
  catch (err) { console.error("Cache save error:", err.message); }
}

function loadCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return;
    const raw = fs.readFileSync(CACHE_FILE, "utf-8").trim();
    if (!raw) return;
    fileCache = JSON.parse(raw);
    const now = Date.now();
    for (const jobId of Object.keys(fileCache)) {
      if (fileCache[jobId].expires < now) {
        safeDelete(fileCache[jobId].filePath);
        delete fileCache[jobId];
      }
    }
    saveCache();
    console.log(`📦 Cache loaded: ${Object.keys(fileCache).length} job(s)`);
  } catch (err) {
    console.error("Cache load error:", err.message);
    fileCache = {};
  }
}

function addToCache(jobId, filePath) {
  fileCache[jobId] = { filePath, expires: Date.now() + CACHE_TTL_MS };
  saveCache();
}

function getFromCache(jobId) {
  const entry = fileCache[jobId];
  if (!entry) return null;
  if (entry.expires < Date.now() || !fs.existsSync(entry.filePath)) {
    safeDelete(entry.filePath);
    delete fileCache[jobId];
    saveCache();
    return null;
  }
  return entry.filePath;
}

function removeFromCache(jobId) {
  delete fileCache[jobId];
  saveCache();
}

function ensureDirs() {
  [DOWNLOAD_DIR, path.dirname(CACHE_FILE)].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

/* ===============================
   DEVICE SERIAL
   Must never change for this Pi — the server uses it to recognise the
   device and give back the same machine. Order of preference:
     1. the serial already saved in config.json
     2. the Raspberry Pi's hardware serial number
     3. a network MAC address (laptops / dev machines)
   A MAC alone is a poor ID on a Pi: it changes between Wi-Fi and Ethernet.
=============================== */
function readPiSerial() {
  for (const file of ["/sys/firmware/devicetree/base/serial-number", "/proc/device-tree/serial-number"]) {
    try {
      const s = fs.readFileSync(file, "utf-8").replace(/\0/g, "").trim();
      if (s && !/^0+$/.test(s)) return `pi-${s}`;
    } catch {}
  }
  try {
    const m = fs.readFileSync("/proc/cpuinfo", "utf-8").match(/^Serial\s*:\s*([0-9a-f]+)/im);
    if (m && !/^0+$/.test(m[1])) return `pi-${m[1]}`;
  } catch {}
  return null;
}

function readMac() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces).sort()) {
    for (const iface of interfaces[name]) {
      if (!iface.internal && iface.mac && iface.mac !== "00:00:00:00:00:00") return iface.mac;
    }
  }
  return null;
}

function getDeviceSerial() {
  if (DEVICE_SERIAL) return DEVICE_SERIAL;
  const saved = (loadConfig() || {}).DEVICE_SERIAL;
  DEVICE_SERIAL = saved || readPiSerial() || readMac() || os.hostname();
  if (!saved) saveConfig({ DEVICE_SERIAL });
  return DEVICE_SERIAL;
}

/* ===============================
   REGISTER MACHINE
   First boot (or after the server rejected our key). The server gives this
   Pi a machine + a brand-new API key; we store both in config.json.
=============================== */
async function registerMachine(retries = 5) {
  const deviceSerial = getDeviceSerial();
  const setupCode = String((loadConfig() || {}).SETUP_CODE || "").trim();
  console.log("🔄 Registering machine —", setupCode ? "with setup code" : `device serial: ${deviceSerial}`);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = setupCode
        ? await axios.post(`${API_BASE}/devices/register`, { setupCode, deviceName: `pi ${os.hostname()} (${deviceSerial})` }, { timeout: 15000 })
        : await axios.post(`${API_BASE}/register-machine`, { deviceSerial }, { timeout: 15000 });

      const machineId = res.data.MACHINE_ID || res.data.machine_id || res.data.machineId;
      const apiKey    = res.data.API_KEY    || res.data.api_key    || res.data.apiKey;
      if (!machineId || !apiKey) {
        throw new Error(`Server reply is missing MACHINE_ID/API_KEY (got: ${Object.keys(res.data).join(", ")})`);
      }

      // Keep using the address we just registered through — it's proven to
      // work. (The API_BASE in the reply comes from a server setting that
      // could be stale.)
      saveConfig({ MACHINE_ID: machineId, API_KEY: apiKey, API_BASE, DEVICE_SERIAL: deviceSerial });
      if (setupCode) {
        const c = loadConfig() || {};
        delete c.SETUP_CODE; // one-time code — never keep it around
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2));
      }
      console.log("✅ Machine registered — MACHINE_ID:", machineId);
      return loadConfig();
    } catch (err) {
      const status = err.response?.status;
      let serverMsg = err.response?.data?.error;
      if (status === 410) serverMsg = "Ask the admin for a setup code and put it in config.json as SETUP_CODE, then restart.";
      console.error(`❌ Registration attempt ${attempt}/${retries} failed:`, serverMsg || err.message);
      // A wrong / expired code or a refused legacy registration won't fix itself by retrying now.
      if (status === 403 || status === 410) throw new Error(serverMsg);
      if (attempt < retries) await delay(NETWORK_ERROR_CODES.has(err.code) ? 5000 : 3000);
      else throw new Error(serverMsg || err.message);
    }
  }
}

/* ===============================
   REQUEST SIGNING (must match backend verifyMachine.js)
   signature = HMAC-SHA256(apiKey, machineId + timestamp + JSON(body))
=============================== */
function signRequest(body) {
  const timestamp = Date.now().toString();
  const signature = crypto
    .createHmac("sha256", API_KEY)
    .update(MACHINE_ID + timestamp + JSON.stringify(body || {}))
    .digest("hex");
  return { timestamp, signature };
}

function getHeaders(body) {
  const { timestamp, signature } = signRequest(body);
  return {
    "X-Machine-Id": MACHINE_ID,
    "X-Api-Key":    API_KEY,
    "X-Timestamp":  timestamp,
    "X-Signature":  signature,
  };
}

/* ===============================
   VERIFY SAVED KEY
   Returns "ok", "rejected" (server said no → re-register) or
   "unreachable" (network / server error → keep the key, retry later).
=============================== */
async function verifyKeyWithServer() {
  try {
    console.log("🔍 Verifying saved API key with server...");
    const body = { status: "ONLINE" };
    await axios.post(`${API_BASE}/kiosk/heartbeat`, body, { headers: getHeaders(body), timeout: 10000 });
    console.log("✅ API key verified");
    return "ok";
  } catch (err) {
    const status = err.response?.status;
    if (status === 401 || status === 403) {
      console.warn(`⚠️  Server rejected the saved key (HTTP ${status}: ${err.response?.data?.error})`);
      return "rejected";
    }
    console.warn("⚠️  Could not verify key right now — keeping it:", err.response?.data?.error || err.code || err.message);
    return "unreachable";
  }
}

/* ===============================
   INIT MACHINE
=============================== */
function applyConfig(config) {
  MACHINE_ID = config.MACHINE_ID;
  API_KEY    = config.API_KEY;
  if (config.API_BASE)     API_BASE     = normalizeApiBase(config.API_BASE);
  if (config.PRINTER_NAME) PRINTER_NAME = config.PRINTER_NAME;
}

async function initMachine() {
  getDeviceSerial(); // fix the serial before anything can touch config.json
  const networkOk = await waitForNetwork();
  let config = loadConfig();
  const hasCredentials = !!(config?.MACHINE_ID && config?.API_KEY);

  if (!networkOk) {
    if (hasCredentials) {
      console.warn("⚠️  No network at boot — starting with saved config, will keep retrying");
      applyConfig(config);
      return;
    }
    throw new Error("No network and this Pi is not registered yet");
  }

  if (!hasCredentials) {
    console.log("ℹ️  No machine saved yet — registering this Pi...");
    config = await registerMachine();
  } else {
    applyConfig(config);
    if ((await verifyKeyWithServer()) === "rejected") {
      clearMachineCredentials();
      config = await registerMachine();
    }
  }

  applyConfig(config);
  console.log("✅ Machine ready");
  console.log("   MACHINE_ID :", MACHINE_ID);
  console.log("   API_BASE   :", API_BASE);
  console.log("   Serial     :", DEVICE_SERIAL);
  console.log("   Platform   :", process.platform, IS_PI ? "(Raspberry Pi / Linux)" : "");
  console.log("   Config     :", CONFIG_FILE);
}

/* ===============================
   PRINTER DETECTION (CUPS)
=============================== */
function detectPrinter() {
  return new Promise((resolve, reject) => {
    // Prefer the CUPS default printer, else the first one listed.
    exec("lpstat -d", (_e, defOut = "") => {
      const def = defOut.match(/system default destination:\s*(\S+)/);
      if (def) return resolve(def[1]);
      exec("lpstat -p", (err, stdout = "") => {
        if (err) return reject(new Error(`lpstat failed: ${err.message}`));
        const match = stdout.match(/printer\s+(\S+)/);
        if (match) return resolve(match[1]);
        reject(new Error("No printer found in CUPS"));
      });
    });
  });
}

async function ensurePrinter() {
  const config = loadConfig();
  if (config?.PRINTER_NAME) {
    PRINTER_NAME = config.PRINTER_NAME;
    console.log("✅ Printer from config:", PRINTER_NAME);
    return;
  }
  if (IS_WINDOWS) {
    console.log("⚠️  Windows — set PRINTER_NAME in config.json");
    return;
  }
  try {
    PRINTER_NAME = await detectPrinter();
    console.log("✅ Printer detected:", PRINTER_NAME);
    saveConfig({ PRINTER_NAME });
  } catch (err) {
    console.log("⚠️  No printer yet:", err.message, "— retrying in 10s");
    setTimeout(ensurePrinter, 10000);
  }
}

/* ===============================
   PRINTER STATUS (CUPS)
   lpstat -l -p shows the printer's state reasons, e.g. "media-empty-error",
   "media-jam", "toner-empty". Out of paper → paper_level 0, so the server
   locks payments until the printer reports paper again. Printers that don't
   report anything are treated as having paper (same as before).
=============================== */
function printerState() {
  return new Promise((resolve) => {
    if (!PRINTER_NAME || IS_WINDOWS) return resolve({ paperOut: false, jam: false, text: "" });
    exec(`lpstat -l -p "${PRINTER_NAME}"`, { timeout: 5000 }, (err, stdout = "") => {
      const text = String(stdout).toLowerCase();
      resolve({
        paperOut: /media-empty|media-needed|out of paper|no paper/.test(text),
        jam: /media-jam|paper jam/.test(text),
        disabled: /disabled/.test(text),
        text,
      });
    });
  });
}

/* ===============================
   FILE DOWNLOAD
   Customer files are in private storage. We either get a ready-made
   short-lived link (downloadUrl, from /kiosk/unlock) or ask the backend
   for one with a signed request.
=============================== */
async function getDownloadUrl(jobId) {
  const body = {};
  const res = await axios.get(
    `${API_BASE}/kiosk/jobs/${encodeURIComponent(jobId)}/file?format=json`,
    { headers: getHeaders(body), timeout: 15000 }
  );
  if (!res.data?.url) throw new Error("Server did not return a download link");
  return res.data.url;
}

function fileExtension(fileName) {
  const ext = path.extname(String(fileName || "")).toLowerCase();
  return /^\.[a-z0-9]{1,5}$/.test(ext) ? ext : ".pdf";
}

async function downloadJobFile(jobId, { downloadUrl, fileName } = {}) {
  const url = downloadUrl || (await getDownloadUrl(jobId));
  const filePath = path.join(DOWNLOAD_DIR, `${jobId}${fileExtension(fileName)}`);
  console.log(`⬇️  Downloading ${jobId}...`);
  const response = await axios.get(url, { responseType: "arraybuffer", timeout: 60000 });
  fs.writeFileSync(filePath, Buffer.from(response.data));
  console.log("✅ Saved:", filePath);
  return filePath;
}

/* ===============================
   PRE-FETCH (after payment, before the customer types the OTP)
=============================== */
const prefetching = new Set();

async function preFetchJob(jobId) {
  if (!jobId || prefetching.has(jobId) || getFromCache(jobId)) return;
  prefetching.add(jobId);
  try {
    const localPath = await downloadJobFile(jobId);
    addToCache(jobId, localPath);
    console.log(`📦 Pre-fetched ${jobId}`);
  } catch (err) {
    console.error(`❌ Pre-fetch failed for ${jobId}:`, err.response?.data?.error || err.message);
  } finally {
    prefetching.delete(jobId);
  }
}

/* ===============================
   SOCKET
   Joins this kiosk's private room so the server can tell us the moment
   a customer pays ("payment_success"). The poller is the backup.
=============================== */
function joinKioskRoom() {
  if (!socket || !MACHINE_ID || !API_KEY) return;
  const { timestamp, signature } = signRequest({});
  socket.emit("kiosk:join", { machineId: MACHINE_ID, timestamp, apiKey: API_KEY, signature }, (reply) => {
    if (reply?.ok) console.log("🔌 Joined kiosk room for", MACHINE_ID);
    else console.log("🔌 Could not join kiosk room:", reply?.error || "no reply");
  });
}

function connectSocket() {
  const serverBase = API_BASE.replace(/\/api\/?$/, "");
  socket = socketIO(serverBase, {
    reconnection: true,
    reconnectionDelay: 3000,
    reconnectionDelayMax: 10000,
  });

  socket.on("connect", () => {
    console.log("🔌 Socket connected to", serverBase);
    joinKioskRoom(); // rooms are lost on every reconnect, so join each time
  });
  socket.on("payment_success", ({ jobId, machineId } = {}) => {
    if (machineId !== MACHINE_ID) return;
    console.log("💳 Payment received for", jobId);
    preFetchJob(jobId);
  });
  socket.on("disconnect", (reason) => console.log("🔌 Socket disconnected:", reason));
  socket.on("connect_error", (err) => console.log("🔌 Socket connect error:", err.message));
}

/* ===============================
   POLLER (backup for missed socket events)
=============================== */
function startPoller() {
  async function poll() {
    try {
      const body = {};
      const res = await axios.get(`${API_BASE}/kiosk/pending-jobs`, { headers: getHeaders(body), timeout: 15000 });
      const jobs = res.data?.jobs || [];
      if (jobs.length) console.log(`🔍 ${jobs.length} paid job(s) waiting`);
      for (const job of jobs) await preFetchJob(job.job_id);
    } catch (err) {
      console.log("🔍 Poller error:", err.response?.data?.error || err.message);
    }
  }
  poll();
  setInterval(poll, POLL_INTERVAL);
}

/* ===============================
   PRINT
=============================== */
function printFile(filePath, job) {
  if (!PRINTER_NAME) return Promise.reject(new Error("Printer not ready"));
  const copies = Math.max(1, parseInt(job.copies, 10) || 1);
  let command;

  if (IS_WINDOWS) {
    const sumatra = [
      "C:\\Program Files\\SumatraPDF\\SumatraPDF.exe",
      "C:\\Program Files (x86)\\SumatraPDF\\SumatraPDF.exe",
    ].find((p) => fs.existsSync(p));
    if (!sumatra) return Promise.reject(new Error("SumatraPDF not installed"));
    const duplex = job.printSide === "duplex" ? ",duplexlong" : "";
    const color  = job.color === "bw" ? ",monochrome" : ",color";
    command = `"${sumatra}" -print-to "${PRINTER_NAME}" -print-settings "${copies}x${duplex}${color}" -silent "${filePath}"`;
  } else {
    command = [
      "lp",
      `-d "${PRINTER_NAME}"`,
      `-n ${copies}`,
      job.printSide === "duplex" ? "-o sides=two-sided-long-edge" : "-o sides=one-sided",
      job.color === "bw" ? "-o ColorModel=Gray -o print-color-mode=monochrome" : "",
      job.paperSize === "A3" ? "-o media=A3" : "-o media=A4",
      "-o fit-to-page",
      `"${filePath}"`,
    ].filter(Boolean).join(" ");
  }

  console.log("🖨  Print command:", command);
  return new Promise((resolve, reject) => {
    exec(command, (err, stdout, stderr) => {
      if (err) return reject(new Error(`Printer error: ${stderr || err.message}`));
      if (stdout) console.log("🖨 ", stdout.trim());
      resolve(stdout);
    });
  });
}

/* ===============================
   HEARTBEAT
=============================== */
function startHeartbeat() {
  let reRegistering = false;

  async function beat() {
    try {
      const ps = await printerState();
      const body = {
        cpu_usage:   Number(os.loadavg()[0].toFixed(2)),
        // Real reading from CUPS when the printer reports it; otherwise "has paper".
        paper_level: ps.paperOut ? 0 : 100,
        status:      !PRINTER_NAME ? "NO_PRINTER" : ps.jam || ps.disabled ? "ERROR" : "ONLINE",
      };
      await axios.post(`${API_BASE}/kiosk/heartbeat`, body, { headers: getHeaders(body), timeout: 10000 });
      console.log("💓 Heartbeat sent");
    } catch (err) {
      const status = err.response?.status;
      const msg = err.response?.data?.error || err.code || err.message;
      console.log(`❌ Heartbeat failed (HTTP ${status || "-"}): ${msg}`);

      // Only a real key problem means re-register. "Request expired" is the
      // Pi's clock being wrong — re-registering would not fix that.
      if ((status === 403 || (status === 401 && msg !== "Request expired")) && !reRegistering) {
        reRegistering = true;
        try {
          console.log("🔄 Key rejected — re-registering...");
          clearMachineCredentials();
          applyConfig(await registerMachine());
          joinKioskRoom();
          console.log("✅ Re-registered as", MACHINE_ID);
        } catch (regErr) {
          console.error("❌ Re-registration failed:", regErr.message);
        } finally {
          reRegistering = false;
        }
      } else if (msg === "Request expired") {
        console.log("🕒 The Pi's clock is wrong — check internet time (timedatectl).");
      }
    }
  }

  beat();
  setInterval(beat, HEARTBEAT_INTERVAL);
}

/* ===============================
   INPUT PARSER
=============================== */
const isOtp     = (s) => /^\d{4}$/.test(s);
const isQrToken = (s) => /^[a-f0-9]{64}$/i.test(s);

function parseInput(input) {
  input = String(input || "").trim();
  if (input.startsWith("PRINTJOB:")) {
    const token = input.slice("PRINTJOB:".length).trim();
    if (isQrToken(token)) return { qrToken: token };
  }
  if (isOtp(input))     return { otp: input };
  if (isQrToken(input)) return { qrToken: input };
  return null;
}

/* ===============================
   MAIN PRINT FLOW
=============================== */
let busy = false;
let manualJob = null; // COPY / SCAN in progress: { jobId, jobType, pages, copies, color, scanUploadUrl, files[], done }

async function markFailed(jobId, error) {
  try {
    const failBody = { jobId, error: String(error || "").slice(0, 200) };
    await axios.post(`${API_BASE}/kiosk/mark-failed`, failBody, { headers: getHeaders(failBody), timeout: 10000 });
    console.log("↩️  Job marked failed (refund requested)");
  } catch {}
}

async function handleInput(input) {
  if (!ready)  return startupError ? `❌ Kiosk not ready: ${startupError}` : "⏳ Kiosk is starting, please wait...";
  if (busy || manualJob) return "⏳ Please wait — another order is in progress";

  const payload = parseInput(input);
  if (!payload) return "❌ Invalid OTP (must be 4 digits)";

  busy = true;
  let localFilePath = null;
  let jobId = null;

  try {
    const unlockRes = await axios.post(`${API_BASE}/kiosk/unlock`, payload, {
      headers: getHeaders(payload), timeout: 15000,
    });
    const job = unlockRes.data;
    jobId = job.jobId;
    const jobType = job.jobType || "PRINT";
    console.log("🔓 Job unlocked:", jobId, jobType);

    // Photocopy / scan: the customer puts each page on the scanner glass.
    if (jobType === "COPY" || jobType === "SCAN") {
      if (!(await hasScanner())) {
        await markFailed(jobId, "No scanner connected to this kiosk");
        jobId = null;
        return "❌ This machine can't scan right now. Your payment is being refunded.";
      }
      manualJob = {
        jobId, jobType, pages: Number(job.pages) || 1, copies: Number(job.copies) || 1,
        color: job.color, scanUploadUrl: job.scanUploadUrl || null, files: [], done: 0, lastActivity: Date.now(),
      };
      jobId = null; // not finished — don't mark failed in finally
      return `📄 ${jobType}`;
    }

    localFilePath = getFromCache(jobId);
    if (localFilePath) {
      console.log("⚡ Using pre-downloaded file");
    } else {
      localFilePath = await downloadJobFile(jobId, { downloadUrl: job.downloadUrl, fileName: job.fileName });
    }

    await printFile(localFilePath, job);
    console.log("🖨  Sent to printer");

    const markBody = { jobId };
    await axios.post(`${API_BASE}/kiosk/mark-printed`, markBody, { headers: getHeaders(markBody), timeout: 10000 });
    return "✅ Printed Successfully";
  } catch (err) {
    console.error("❌ Print flow error:", err.response?.data || err.message);
    if (jobId) await markFailed(jobId, err.response?.data?.error || err.message);
    return `❌ ${err.response?.data?.error || err.message || "Unknown error"}`;
  } finally {
    busy = false;
    if (jobId) removeFromCache(jobId);
    safeDelete(localFilePath);
  }
}

/* ===============================
   PHOTOCOPY / SCAN (multifunction printer, SANE "scanimage")
=============================== */
function run(cmd, timeout = 120000) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout)));
  });
}

let scannerCache = null;
async function hasScanner() {
  if (IS_WINDOWS) return false;
  if (scannerCache && Date.now() - scannerCache.at < 5 * 60 * 1000) return scannerCache.ok;
  let ok = false;
  try { ok = /device `/.test(await run("scanimage -L", 20000)); } catch {}
  scannerCache = { ok, at: Date.now() };
  return ok;
}

/* One A4 page from the scanner glass → PNG file */
async function scanPage(color) {
  const file = path.join(DOWNLOAD_DIR, `scan-${Date.now()}.png`);
  const mode = color === "color" ? "Color" : "Gray";
  await run(`scanimage --format=png --mode ${mode} --resolution 200 -x 210 -y 297 > "${file}"`, 120000);
  if (!fs.existsSync(file) || fs.statSync(file).size < 1000) throw new Error("The scanner returned an empty page");
  return file;
}

/* PNG pages → one PDF (A4) */
async function pagesToPdf(files) {
  const { PDFDocument } = require("pdf-lib");
  const pdf = await PDFDocument.create();
  for (const f of files) {
    const img = await pdf.embedPng(fs.readFileSync(f));
    const page = pdf.addPage([595.28, 841.89]);
    const scale = Math.min(595.28 / img.width, 841.89 / img.height);
    page.drawImage(img, { x: 0, y: 841.89 - img.height * scale, width: img.width * scale, height: img.height * scale });
  }
  return Buffer.from(await pdf.save());
}

function getManualJob() {
  if (!manualJob) return null;
  const { jobId, jobType, pages, copies, done } = manualJob;
  return { jobId, jobType, pages, copies, done };
}

function cleanupManual() {
  if (manualJob) manualJob.files.forEach(safeDelete);
  manualJob = null;
}

async function finishManual() {
  const job = manualJob;
  if (!job.done) throw new Error("Scan at least one page first");
  if (job.jobType === "SCAN") {
    const pdf = await pagesToPdf(job.files);
    await axios.put(job.scanUploadUrl, pdf, { headers: { "Content-Type": "application/pdf" }, timeout: 120000, maxBodyLength: Infinity });
  }
  const markBody = { jobId: job.jobId };
  await axios.post(`${API_BASE}/kiosk/mark-printed`, markBody, { headers: getHeaders(markBody), timeout: 10000 });
}

/* Buttons on the photocopy / scan screen: "scan" | "finish" | "cancel" */
async function manualAction(action) {
  if (!manualJob) return "❌ No order in progress";
  if (busy) return "⏳ Please wait…";
  busy = true;
  manualJob.lastActivity = Date.now();
  try {
    if (action === "scan") {
      if (manualJob.done >= manualJob.pages) return "✅ All pages done — tap Finish";
      const file = await scanPage(manualJob.color);
      if (manualJob.jobType === "COPY") {
        await printFile(file, { copies: manualJob.copies, color: manualJob.color, printSide: "single", paperSize: "A4" });
        safeDelete(file);
      } else {
        manualJob.files.push(file);
      }
      manualJob.done += 1;
      return manualJob.done >= manualJob.pages ? "✅ All pages done — tap Finish" : `✅ Page ${manualJob.done} done — place the next page`;
    }
    if (action === "finish") {
      await finishManual();
      cleanupManual();
      return "✅ Done";
    }
    if (action === "cancel") {
      const job = manualJob;
      if (job.done > 0) {
        await finishManual(); // pages already copied / scanned are delivered
        cleanupManual();
        return "✅ Done";
      }
      await markFailed(job.jobId, "Cancelled at the kiosk before any page");
      cleanupManual();
      return "↩️ Cancelled — your payment is being refunded";
    }
    return "❌ Unknown action";
  } catch (err) {
    console.error("❌ Manual job error:", err.response?.data || err.message);
    return `❌ ${err.response?.data?.error || err.message}`;
  } finally {
    busy = false;
  }
}

/* Nobody touched a photocopy / scan order for 10 minutes → finish what was done, or refund. */
setInterval(() => {
  if (manualJob && !busy && Date.now() - manualJob.lastActivity > 10 * 60 * 1000) {
    console.log("⌛ Photocopy / scan order abandoned — closing it");
    manualAction("cancel");
  }
}, 30000).unref();

/* ===============================
   STATUS (shown on screen)
=============================== */
function getStatus() {
  return {
    ready,
    error:        startupError,
    machineId:    MACHINE_ID,
    apiBase:      API_BASE,
    printer:      PRINTER_NAME || null,
    printerReady: !!PRINTER_NAME,
    cacheSize:    Object.keys(fileCache).length,
    platform:     process.platform,
  };
}

/* ===============================
   START — retries until it works (e.g. if no free machine exists yet,
   create one in the admin panel and this Pi will pick it up).
=============================== */
let started = false;

async function start() {
  if (started) return;
  started = true;
  ensureDirs();
  loadCache();

  for (;;) {
    try {
      await initMachine();
      break;
    } catch (err) {
      startupError = err.message;
      console.error(`❌ Start-up failed: ${err.message} — retrying in ${START_RETRY_MS / 1000}s`);
      await delay(START_RETRY_MS);
    }
  }

  startupError = null;
  ready = true;
  await ensurePrinter();
  startHeartbeat();
  connectSocket();
  startPoller();
}

/* CLI mode for testing without a screen:  node kioskCore.js */
async function mainLoop() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));
  console.log("\n📟 Enter OTP or scan QR code\n");
  for (;;) {
    const input = (await ask("OTP / QR > ")).trim();
    if (input) console.log("→", await handleInput(input), "\n");
  }
}

if (require.main === module) {
  start().then(mainLoop);
}

module.exports = { start, handleInput, getStatus, getManualJob, manualAction };
