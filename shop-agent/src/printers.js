// src/printers.js — talking to the real printers on this computer.
//
//   Windows   → SumatraPDF (bundled with the pdf-to-printer package), silent printing,
//               printer status from PowerShell Get-Printer
//   Mac/Linux → CUPS `lp` / `lpstat`
//   dry-run   → no printer at all: each "print" is saved as a PDF in ./dry-run-prints
//               (for testing the whole flow on a laptop)
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

const IS_WINDOWS = os.platform() === "win32";
const DRY_RUN_DIR = path.join(__dirname, "..", "dry-run-prints");

function run(cmd, args, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        // Show the printer's own message ("paper jam") instead of the whole command line.
        const msg = String(stderr || "").trim();
        if (msg) err.message = msg.slice(0, 200);
        else if (err.killed) err.message = "Printer did not respond in time";
        return reject(err);
      }
      resolve(String(stdout));
    });
  });
}

/* ── List the printers installed on this computer ── */
async function listSystemPrinters() {
  if (IS_WINDOWS) {
    const ptp = require("pdf-to-printer");
    const list = await ptp.getPrinters();
    return list.map((p) => ({ systemName: p.name, paperSizes: p.paperSizes || [] }));
  }
  try {
    const out = await run("lpstat", ["-e"], 15000);
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((name) => ({ systemName: name, paperSizes: [] }));
  } catch {
    return [];
  }
}

/* ── Status of each configured printer: ONLINE | OFFLINE | ERROR (+ message) ── */
// Windows PrinterStatus values (can be combined, e.g. "Printing, TonerLow")
const WIN_OFFLINE = /offline|paused|notavailable|pendingdeletion|serverunknown/i;
const WIN_ERROR = /error|jam|paperout|paperproblem|notoner|dooropen|userintervention|outofmemory|outputbinfull|manualfeed|pagepunt/i;

async function getStatuses(printers, dryRun) {
  if (dryRun) return printers.map((p) => ({ systemName: p.systemName, status: "ONLINE", message: "dry-run" }));

  if (IS_WINDOWS) {
    try {
      const ps = "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); " +
        "Get-Printer | Select-Object Name,@{n='Status';e={$_.PrinterStatus.ToString()}},@{n='Offline';e={$_.WorkOffline}} | ConvertTo-Json -Compress";
      const out = await run("powershell.exe", ["-NoProfile", "-Command", ps], 20000);
      let rows = JSON.parse(out || "[]");
      if (!Array.isArray(rows)) rows = [rows];
      const byName = new Map(rows.map((r) => [r.Name, r]));
      return printers.map((p) => {
        const r = byName.get(p.systemName);
        if (!r) return { systemName: p.systemName, status: "OFFLINE", message: "Printer not installed on this computer" };
        if (r.Offline) return { systemName: p.systemName, status: "OFFLINE", message: "Set to 'Use printer offline'" };
        const st = String(r.Status || "Normal").replace(/\s+/g, "");
        if (WIN_OFFLINE.test(st)) return { systemName: p.systemName, status: "OFFLINE", message: st };
        if (WIN_ERROR.test(st)) return { systemName: p.systemName, status: "ERROR", message: st };
        return { systemName: p.systemName, status: "ONLINE", message: /^normal$/i.test(st) ? null : st };
      });
    } catch (err) {
      // Can't read status — assume they work rather than blocking every order.
      return printers.map((p) => ({ systemName: p.systemName, status: "ONLINE", message: "status unknown" }));
    }
  }

  return Promise.all(printers.map(async (p) => {
    try {
      const out = await run("lpstat", ["-p", p.systemName], 10000);
      if (/disabled/i.test(out)) return { systemName: p.systemName, status: "OFFLINE", message: out.trim().slice(0, 200) };
      return { systemName: p.systemName, status: "ONLINE" };
    } catch {
      return { systemName: p.systemName, status: "OFFLINE", message: "Printer not found" };
    }
  }));
}

/* ── Print one PDF ──
   job = { jobId, orderCode, copies, color: "bw"|"color", printSide: "single"|"duplex", paperSize } */
async function printPdf(file, printer, job, dryRun) {
  const copies = Math.max(1, Math.min(100, Number(job.copies) || 1));
  const duplex = job.printSide === "duplex";
  const mono = job.color !== "color";

  if (dryRun) {
    await fsp.mkdir(DRY_RUN_DIR, { recursive: true });
    const safe = (s) => String(s).replace(/[^\w.-]+/g, "_");
    const base = `${safe(job.orderCode || "")}_${safe(printer.displayName || printer.systemName)}_${safe(job.jobId)}`;
    await fsp.copyFile(file, path.join(DRY_RUN_DIR, `${base}.pdf`));
    await fsp.writeFile(path.join(DRY_RUN_DIR, `${base}.txt`),
      `order ${job.orderCode}\nprinter ${printer.systemName}\ncopies ${copies}\n` +
      `color ${mono ? "B&W" : "colour"}\nsides ${duplex ? "duplex" : "single"}\npaper ${job.paperSize}\n`);
    await new Promise((r) => setTimeout(r, 1500)); // feels like a printer
    return;
  }

  if (IS_WINDOWS) {
    const ptp = require("pdf-to-printer");
    await ptp.print(file, {
      printer: printer.systemName,
      copies,
      monochrome: mono,
      side: duplex ? "duplexlong" : "simplex",
      paperSize: job.paperSize || "A4",
      scale: "fit",
    });
    return;
  }

  const args = ["-d", printer.systemName, "-n", String(copies),
    "-o", `sides=${duplex ? "two-sided-long-edge" : "one-sided"}`,
    "-o", `media=${job.paperSize || "A4"}`, "-o", "fit-to-page"];
  if (mono) args.push("-o", "print-color-mode=monochrome", "-o", "ColorModel=Gray");
  args.push(file);
  await run("lp", args, 120000);
}

module.exports = { IS_WINDOWS, DRY_RUN_DIR, listSystemPrinters, getStatuses, printPdf, fs };
