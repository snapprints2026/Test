// src/jobs/sla.cron.js
//   every 5 min        record machines going down / coming back (downtime_events)
//   every day 00:30 IST recompute this month's (and last month's) SLA reports
const cron = require("node-cron");
const { trackDowntime, dailyReports } = require("../services/sla.service");

let tracking = false;
async function runTracking() {
  if (tracking) return;
  tracking = true;
  try {
    const { opened, closed } = await trackDowntime();
    if (opened || closed) console.log(`⏱  Downtime: ${opened} started, ${closed} ended`);
  } catch (err) {
    console.error("DOWNTIME TRACKING ERROR:", err);
  } finally {
    tracking = false;
  }
}

async function runReports() {
  try {
    const n = await dailyReports();
    console.log(`📈 SLA reports refreshed for ${n} machine-month(s)`);
  } catch (err) {
    console.error("SLA REPORT ERROR:", err);
  }
}

function startSlaCron() {
  cron.schedule("*/5 * * * *", runTracking);
  cron.schedule("30 0 * * *", runReports, { timezone: "Asia/Kolkata" });
  setTimeout(runTracking, 20000); // first check shortly after start
  console.log("✅ SLA cron scheduled (downtime every 5 min, reports daily 00:30 IST)");
}

module.exports = { startSlaCron, runTracking, runReports };
