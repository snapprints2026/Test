// src/services/pricing.service.js
// What a job costs.
//
// A UNIT is one printed page, or one sheet (2 pages) when double-sided.
// SCAN is charged per page scanned.
//   PRINT / FORM / COPY: units = pages × copies          (single-sided)
//                        units = ceil(pages / 2) × copies (double-sided)
//   SCAN:                units = pages
//
// The rate per unit comes from the most specific ACTIVE pricing rule
// (pricing_rules table): MACHINE > CONTRACT > GLOBAL, then the rule that
// matches more of job type / colour / paper / sides, then the newest.
// With no matching rule the built-in defaults below apply (the old prices):
//   B&W single ₹2 · B&W duplex ₹4 · colour single ₹5 · colour duplex ₹10 · scan ₹3/page
//
// The customer page gets the same rates as a table (priceTable) so its
// instant preview always matches what is charged.
const db = require("../database/db");
const { today } = require("./time.service");

const DEFAULT_RATES = {
  bw: { single: 2, duplex: 4 },
  color: { single: 5, duplex: 10 },
};
const DEFAULT_SCAN_RATE = { bw: 3, color: 3 };

const SCOPE_WEIGHT = { MACHINE: 3, CONTRACT: 2, GLOBAL: 1 };
const round2 = (n) => Math.round(Number(n) * 100) / 100;

/* Active rules that can apply to this machine (and its active contract) today. */
async function loadRules({ machineId, contractId }, conn = db) {
  const [rows] = await conn.query(
    `SELECT id, scope, contract_id, machine_id, job_type, color, paper_size, print_side, rate,
            DATE_FORMAT(effective_from, '%Y-%m-%d') AS effective_from
     FROM pricing_rules
     WHERE status='ACTIVE' AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)
       AND (scope='GLOBAL'
            OR (scope='CONTRACT' AND contract_id <=> ?)
            OR (scope='MACHINE' AND machine_id <=> ?))`,
    [today(), today(), contractId || null, machineId || null]
  );
  return rows;
}

function defaultRate({ jobType, color, printSide }) {
  if (jobType === "SCAN") return DEFAULT_SCAN_RATE[color === "color" ? "color" : "bw"];
  return DEFAULT_RATES[color === "color" ? "color" : "bw"][printSide === "duplex" ? "duplex" : "single"];
}

/* → { rate, ruleId } */
function resolveRate(rules, { jobType = "PRINT", color = "bw", paperSize = "A4", printSide = "single" }) {
  let best = null;
  for (const r of rules) {
    if (r.job_type !== "ANY" && r.job_type !== jobType) continue;
    if (r.color !== "any" && r.color !== color) continue;
    if (r.paper_size !== "any" && r.paper_size !== paperSize) continue;
    if (jobType !== "SCAN" && r.print_side !== "any" && r.print_side !== printSide) continue;
    const specificity =
      (r.job_type !== "ANY") + (r.color !== "any") + (r.paper_size !== "any") + (r.print_side !== "any");
    const score = SCOPE_WEIGHT[r.scope] * 100 + specificity * 10;
    const newer = (a, b) =>
      String(a.effective_from) > String(b.effective_from) || (String(a.effective_from) === String(b.effective_from) && a.id > b.id);
    if (!best || score > best.score || (score === best.score && newer(r, best.rule))) best = { score, rule: r };
  }
  if (best) return { rate: Number(best.rule.rate), ruleId: best.rule.id };
  return { rate: defaultRate({ jobType, color, printSide }), ruleId: null };
}

function unitsFor(job) {
  const pages = Math.max(0, Number(job.total_pages ?? job.pages) || 0);
  const copies = Math.max(1, Number(job.copies) || 1);
  if ((job.job_type || job.jobType) === "SCAN") return pages;
  return (job.print_side || job.printSide) === "duplex" ? Math.ceil(pages / 2) * copies : pages * copies;
}

/* Price a print_jobs row. machineCtx needs machine_id and activeContractId. */
async function quoteJob(job, machineCtx, conn = db) {
  const rules = await loadRules(
    { machineId: job.machine_id || machineCtx.machine_id, contractId: machineCtx ? machineCtx.activeContractId : null },
    conn
  );
  const { rate, ruleId } = resolveRate(rules, {
    jobType: job.job_type || "PRINT",
    color: job.color || "bw",
    paperSize: job.paper_size || "A4",
    printSide: job.print_side || "single",
  });
  const units = unitsFor(job);
  const total = round2(units * rate);
  return { units, rate, ruleId, total, paise: Math.round(total * 100) };
}

/* Every rate this machine charges, for the customer page:
   { PRINT: { bw: { single: { A4: 2, A3: 2 }, duplex: {…} }, color: {…} }, SCAN: { bw: { single: { A4: 3 } } } } */
async function priceTable(machineCtx, jobTypes = ["PRINT", "FORM", "COPY", "SCAN"]) {
  const rules = await loadRules({ machineId: machineCtx.machine_id, contractId: machineCtx.activeContractId });
  const table = {};
  for (const jobType of jobTypes) {
    table[jobType] = {};
    for (const color of ["bw", "color"]) {
      table[jobType][color] = {};
      for (const printSide of jobType === "SCAN" ? ["single"] : ["single", "duplex"]) {
        table[jobType][color][printSide] = {};
        for (const paperSize of ["A4", "A3"]) {
          table[jobType][color][printSide][paperSize] = resolveRate(rules, { jobType, color, paperSize, printSide }).rate;
        }
      }
    }
  }
  return table;
}

module.exports = { DEFAULT_RATES, DEFAULT_SCAN_RATE, loadRules, resolveRate, unitsFor, quoteJob, priceTable, round2 };
