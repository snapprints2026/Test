// src/setup.js — one-time setup on the shop computer:  npm run setup
//
// 1. Asks for the server address and the setup code from the admin panel
//    (Machines → your SHOP machine → setup code), and registers this computer.
// 2. Lists the printers installed on this computer and asks which ones
//    SnapPrints may use: black & white or colour, double-sided, paper sizes.
// 3. Saves everything to config.json.
//
// No printer here yet? Choose "dry-run": orders are saved as PDF files in
// ./dry-run-prints instead of printed — handy for testing on a laptop.
//
// Non-interactive (for scripts):
//   node src/setup.js --api http://localhost:5000/api --code ABCD-EFGH --dry-run \
//        --printer "Demo B&W Copier|BW|duplex|A4,A3" --printer "Demo Colour Copier|COLOR|single|A4"
const os = require("os");
const readline = require("readline/promises");
const { register } = require("./api");
const { loadConfig, saveConfig, CONFIG_PATH } = require("./config");
const { listSystemPrinters, IS_WINDOWS } = require("./printers");

function parseArgs(argv) {
  const out = { printers: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--api") out.api = argv[++i];
    else if (a === "--code") out.code = argv[++i];
    else if (a === "--name") out.name = argv[++i];
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--printer") out.printers.push(argv[++i]);
  }
  return out;
}

function parsePrinterSpec(spec) {
  // "System name|BW|duplex|A4,A3"  (display name = system name)
  const [systemName, kind = "BW", side = "single", sizes = "A4"] = spec.split("|");
  return {
    systemName,
    displayName: systemName,
    kind: kind.toUpperCase() === "COLOR" ? "COLOR" : "BW",
    duplex: /^duplex$/i.test(side),
    paperSizes: sizes.split(",").map((s) => s.trim().toUpperCase()).filter((s) => ["A4", "A3"].includes(s)),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const interactive = !args.code;
  const rl = interactive ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
  const ask = async (q, dflt = "") => {
    if (!rl) return dflt;
    const a = (await rl.question(dflt ? `${q} [${dflt}]: ` : `${q}: `)).trim();
    return a || dflt;
  };
  const yes = async (q, dflt = false) => /^y/i.test(await ask(`${q} (y/n)`, dflt ? "y" : "n"));

  console.log("\n=== SnapPrints Shop Print Agent — setup ===\n");
  const existing = loadConfig();

  let apiBase = (args.api || await ask("Server address (ends with /api)",
    existing?.apiBase || "http://localhost:5000/api")).replace(/\/+$/, "");

  let reg = null;
  if (existing && existing.apiBase === apiBase && interactive && !(await yes(`This computer is already set up as ${existing.machineId}. Register again with a new setup code?`))) {
    reg = { MACHINE_ID: existing.machineId, API_KEY: existing.apiKey };
  } else {
    const code = args.code || await ask("Setup code from the admin panel (e.g. K7PD-3MXQ)");
    const deviceName = args.name || os.hostname();
    reg = await register(apiBase, code, deviceName);
    if (reg.MODULE !== "SHOP") {
      throw new Error(`${reg.MACHINE_ID} is a ${reg.MODULE} machine. In the admin panel, set its module to "Shop computer", or use the Raspberry Pi software.`);
    }
    console.log(`\n✓ Registered as ${reg.MACHINE_ID}\n`);
  }

  let dryRun = !!args.dryRun;
  let printers = args.printers.map(parsePrinterSpec);

  if (interactive) {
    const system = await listSystemPrinters().catch(() => []);
    if (!system.length) {
      console.log(IS_WINDOWS
        ? "No printers found. Install the copier's driver (Settings → Printers & scanners) and run setup again,\nor continue in dry-run mode to test without a printer."
        : "No printers found on this computer.");
    }
    dryRun = await yes("Use dry-run mode (save PDFs to a folder instead of printing)?", !system.length);

    if (dryRun) {
      if (await yes("Add two demo printers (Demo B&W Copier + Demo Colour Copier)?", true)) {
        printers = [
          { systemName: "Demo B&W Copier", displayName: "B&W Copier", kind: "BW", duplex: true, paperSizes: ["A4", "A3"] },
          { systemName: "Demo Colour Copier", displayName: "Colour Copier", kind: "COLOR", duplex: false, paperSizes: ["A4"] },
        ];
      }
    }

    if (!printers.length) {
      console.log("\nPrinters on this computer:");
      system.forEach((p, i) => console.log(`  ${i + 1}. ${p.systemName}`));
      const picks = (await ask("\nWhich ones should SnapPrints use? Numbers separated by commas (e.g. 1,3)"))
        .split(",").map((s) => parseInt(s, 10) - 1).filter((i) => system[i]);
      for (const i of picks) {
        const sp = system[i];
        console.log(`\n— ${sp.systemName}`);
        const color = await yes("  Can it print in COLOUR?", false);
        const duplex = await yes("  Can it print double-sided (duplex)?", true);
        const a3 = await yes("  Does it have A3 paper loaded?", false);
        const displayName = await ask("  Name customers see", color ? "Colour Copier" : "B&W Copier");
        printers.push({
          systemName: sp.systemName, displayName, kind: color ? "COLOR" : "BW", duplex,
          paperSizes: a3 ? ["A4", "A3"] : ["A4"],
        });
      }
    }
  }

  if (!printers.length) throw new Error("No printers chosen — nothing to print on. Run setup again.");

  const cfg = {
    apiBase,
    machineId: reg.MACHINE_ID,
    apiKey: reg.API_KEY,
    dryRun,
    screenPort: existing?.screenPort || 7300,
    printers,
  };
  saveConfig(cfg);
  if (rl) rl.close();

  console.log(`\n✓ Saved ${CONFIG_PATH}`);
  console.log(`  Machine ${cfg.machineId} · ${dryRun ? "DRY-RUN (no real printing)" : "printing for real"}`);
  printers.forEach((p) => console.log(`  • ${p.displayName}  [${p.kind}${p.duplex ? ", duplex" : ""}, ${p.paperSizes.join("/")}]  → ${p.systemName}`));
  console.log("\nStart the agent with:  npm start\n");
}

main().catch((err) => {
  console.error(`\n✗ Setup failed: ${err.message}\n`);
  process.exit(1);
});
