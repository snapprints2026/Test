// src/utils/pricing.js
// Instant price preview while the customer changes options.
// The rates come from the machine's status (price_table) — the same approved
// rates the backend charges, so the preview always matches the payment.
//   unit = 1 page, or 1 sheet (2 pages) when printing both sides
//   SCAN is charged per page scanned
const DEFAULTS = { bw: { single: 2, duplex: 4 }, color: { single: 5, duplex: 10 } };
const DEFAULT_SCAN = 3;

export function rateFor(table, { jobType = "PRINT", color = "bw", printSide = "single", paperSize = "A4" }) {
  const side = jobType === "SCAN" ? "single" : printSide;
  const r = table?.[jobType]?.[color]?.[side]?.[paperSize] ?? table?.PRINT?.[color]?.[side]?.[paperSize];
  if (typeof r === "number") return r;
  if (jobType === "SCAN") return DEFAULT_SCAN;
  return DEFAULTS[color === "color" ? "color" : "bw"][side === "duplex" ? "duplex" : "single"];
}

export function calculatePrice({ pages, copies, color, printSide, paperSize, jobType = "PRINT" }, table) {
  const p = Math.max(0, Number(pages) || 0);
  const c = Math.max(1, Number(copies) || 1);
  const units = jobType === "SCAN" ? p : printSide === "duplex" ? Math.ceil(p / 2) * c : p * c;
  const rate = rateFor(table, { jobType, color, printSide, paperSize });
  return { units, rate, total: Math.round(units * rate * 100) / 100 };
}

export const formatRupees = (n) =>
  Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2, maximumFractionDigits: 2 });
