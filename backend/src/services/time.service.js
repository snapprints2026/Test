// src/services/time.service.js
// The database stores UTC. Office hours, invoice dates, financial years and
// monthly reports use the business time zone (BUSINESS_TZ_OFFSET, default
// +05:30 for India — no daylight saving, so a fixed offset is exact).
const env = require("../config/env");

const OFFSET = env.BUSINESS_TZ_OFFSET; // "+05:30"
const OFFSET_MIN = (() => {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(OFFSET);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 330;
})();

/* Date object → the same instant as wall-clock fields in business time (read with getUTC*). */
const toLocal = (d = new Date()) => new Date(new Date(d).getTime() + OFFSET_MIN * 60000);
/* Wall-clock business time given as a UTC-fields Date → real instant. */
const fromLocal = (d) => new Date(d.getTime() - OFFSET_MIN * 60000);

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/* "2026-10-17" in business time */
const today = () => ymd(toLocal());

/* "2026-10-01" → { start, end } as real UTC instants covering that local month */
function monthRange(monthStr) {
  const [y, m] = String(monthStr).slice(0, 7).split("-").map(Number);
  const start = fromLocal(new Date(Date.UTC(y, m - 1, 1)));
  const end = fromLocal(new Date(Date.UTC(y, m, 1)));
  return { start, end, month: `${y}-${pad(m)}-01` };
}

/* Current local month "YYYY-MM-01" (offset in months, e.g. -1 = last month) */
function monthStart(offsetMonths = 0) {
  const l = toLocal();
  const d = new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth() + offsetMonths, 1));
  return ymd(d);
}

/* "YYYY-MM-DD" (local date) → UTC instants for [start of that day, start of next day) */
function dayRange(fromYmd, toYmd) {
  const [y1, m1, d1] = fromYmd.split("-").map(Number);
  const [y2, m2, d2] = toYmd.split("-").map(Number);
  return {
    start: fromLocal(new Date(Date.UTC(y1, m1 - 1, d1))),
    end: fromLocal(new Date(Date.UTC(y2, m2 - 1, d2 + 1))),
  };
}

/* Indian financial year (April–March) for a date: "26-27" */
function financialYear(d = new Date()) {
  const l = toLocal(d);
  const y = l.getUTCFullYear();
  const startYear = l.getUTCMonth() >= 3 ? y : y - 1;
  return `${String(startYear).slice(2)}-${String(startYear + 1).slice(2)}`;
}

const isYmd = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/* SQL expression converting a UTC column to business time, e.g. for DATE() grouping */
const localSql = (col) => `CONVERT_TZ(${col}, '+00:00', '${OFFSET}')`;

module.exports = { OFFSET, OFFSET_MIN, toLocal, fromLocal, ymd, today, monthRange, monthStart, dayRange, financialYear, isYmd, localSql };
