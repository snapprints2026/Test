// scripts/kiosk-simulator.js — pretend to be a Raspberry Pi kiosk (Module 1) on your laptop.
//
//   npm run kiosk:sim -- register K7PD-3MXQ     use the setup code from the dashboard / seed:dev
//   npm run kiosk:sim -- online                 send heartbeats (keep running) so the page says "online"
//   npm run kiosk:sim -- unlock 1234            type the customer's OTP:
//                                               PRINT / FORM → downloads the PDF into backend/kiosk-sim-prints/
//                                               COPY         → pretends to photocopy
//                                               SCAN         → uploads a made-up scanned page
//                                               then marks the order done
//
// It signs every request exactly like the real Pi: HMAC-SHA256(apiKey, machineId + timestamp + body).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const API = (process.env.API_BASE || "http://localhost:5000/api").replace(/\/+$/, "");
const STATE = path.join(__dirname, "../.kiosk-sim.json");
const OUT = path.join(__dirname, "../kiosk-sim-prints");

const load = () => {
  try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { return null; }
};

async function signed(cfg, method, route, body) {
  const json = body ? JSON.stringify(body) : "{}";
  const ts = String(Date.now());
  const sig = crypto.createHmac("sha256", cfg.API_KEY).update(cfg.MACHINE_ID + ts + json).digest("hex");
  const res = await fetch(`${API}${route}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-machine-id": cfg.MACHINE_ID, "x-timestamp": ts, "x-api-key": cfg.API_KEY, "x-signature": sig,
    },
    body: body ? json : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${route} → ${res.status} ${data.error || ""}`);
  return data;
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "register") {
    const res = await fetch(`${API}/devices/register`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ setupCode: arg, deviceName: "Kiosk simulator" }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    if (data.MODULE !== "KIOSK") throw new Error(`${data.MACHINE_ID} is a ${data.MODULE} machine — use the shop agent for it`);
    fs.writeFileSync(STATE, JSON.stringify(data, null, 2));
    console.log(`✓ registered as ${data.MACHINE_ID}`);
    return;
  }

  const cfg = load();
  if (!cfg) throw new Error("Run: npm run kiosk:sim -- register <SETUP_CODE>  first");
  const beat = () => signed(cfg, "POST", "/kiosk/heartbeat", { paper_level: 80, status: "ONLINE" });

  if (cmd === "online") {
    await beat();
    console.log(`✓ ${cfg.MACHINE_ID} online — sending a heartbeat every 30 s (Ctrl+C to stop)`);
    setInterval(() => beat().catch((e) => console.error(e.message)), 30000);
    return;
  }

  if (cmd === "unlock") {
    await beat();
    const job = await signed(cfg, "POST", "/kiosk/unlock", { otp: arg });
    const type = job.jobType || "PRINT";
    console.log(`✓ unlocked ${job.jobId} [${type}]: ${job.fileName || "-"} · ${job.pages} page(s) · ${job.copies} cop${job.copies > 1 ? "ies" : "y"} · ${job.color} · ${job.printSide}`);
    if (type === "COPY") {
      console.log(`✓ "photocopied" ${job.pages} page(s) × ${job.copies}`);
    } else if (type === "SCAN") {
      const { PDFDocument, StandardFonts } = require("pdf-lib");
      const pdf = await PDFDocument.create();
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      for (let i = 0; i < job.pages; i++) pdf.addPage([595, 842]).drawText(`Scanned page ${i + 1}`, { x: 60, y: 760, size: 20, font });
      const up = await fetch(job.scanUploadUrl, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: Buffer.from(await pdf.save()) });
      if (!up.ok) throw new Error(`scan upload failed ${up.status}`);
      console.log(`✓ uploaded a ${job.pages}-page scan`);
    } else {
      const file = await fetch(job.downloadUrl);
      if (!file.ok) throw new Error(`download failed ${file.status}`);
      fs.mkdirSync(OUT, { recursive: true });
      const dest = path.join(OUT, `${job.jobId}.pdf`);
      fs.writeFileSync(dest, Buffer.from(await file.arrayBuffer()));
      console.log(`✓ "printed" to ${dest}`);
    }
    await signed(cfg, "POST", "/kiosk/mark-printed", { jobId: job.jobId });
    console.log("✓ marked printed — the customer's page should now say it's done");
    return;
  }

  console.log("Usage: npm run kiosk:sim -- register <SETUP_CODE> | online | unlock <OTP>");
}

main().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
