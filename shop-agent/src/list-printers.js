// npm run printers — shows the printers installed on this computer and their status.
const { listSystemPrinters, getStatuses } = require("./printers");

(async () => {
  const list = await listSystemPrinters();
  if (!list.length) return console.log("No printers found on this computer.");
  const statuses = await getStatuses(list, false);
  console.log("Printers on this computer:");
  list.forEach((p, i) => {
    const s = statuses[i];
    console.log(`  ${i + 1}. ${p.systemName}  —  ${s.status}${s.message ? ` (${s.message})` : ""}`);
  });
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
