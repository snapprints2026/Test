// src/services/sla.service.js
// Uptime for contracts.
//
// 1. trackDowntime() — every 5 minutes. Opens a downtime_events row when a
//    machine goes down and closes it when it's back:
//      OFFLINE        device not heard from for DOWNTIME_OFFLINE_MINUTES
//      OUT_OF_PAPER   kiosk locked because paper is critically low
//      PRINTER_ERROR  shop computer online but no enabled printer is ready
//    Events are recorded around the clock; reports count only office hours.
//
// 2. computeMonth() — one machine, one month:
//      scheduled = office hours in the month (locations.open_time/close_time/
//                  open_days; 24 × 7 if empty), from installation (or creation)
//                  until now, minus excluded (planned maintenance) periods
//      downtime  = overlap of downtime events with those hours
//      uptime %  = (scheduled − downtime) / scheduled
//    plus the penalty from the contract's penalty_rules and ticket response /
//    resolution breaches. Saved to sla_reports (recomputed daily).
const db = require("../database/db");
const env = require("../config/env");
const { isRecent, listPrinters } = require("./machine.service");
const { OFFSET_MIN, monthRange, monthStart, toLocal } = require("./time.service");
const { round2 } = require("./pricing.service");

const MIN = 60000;

/* ───────────── 1. live tracking ───────────── */
async function trackDowntime() {
  const [list] = await db.query(
    `SELECT machine_id, module, last_seen_at, is_print_locked FROM machines WHERE status='ACTIVE'`
  );
  const [open] = await db.query(`SELECT id, machine_id, reason FROM downtime_events WHERE ended_at IS NULL`);
  const openBy = new Map(open.map((e) => [`${e.machine_id}|${e.reason}`, e]));
  const offlineSecs = env.DOWNTIME_OFFLINE_MINUTES * 60;
  let opened = 0;
  let closed = 0;

  for (const m of list) {
    const offline = !isRecent(m.last_seen_at, offlineSecs);
    let printerProblem = false;
    if (!offline && m.module === "SHOP") {
      const printers = await listPrinters(m.machine_id);
      printerProblem = printers.length > 0 && !printers.some((p) => p.is_enabled && p.is_online);
    }
    const state = {
      OFFLINE: offline,
      OUT_OF_PAPER: !offline && !!m.is_print_locked,
      PRINTER_ERROR: printerProblem,
    };
    for (const [reason, down] of Object.entries(state)) {
      const ev = openBy.get(`${m.machine_id}|${reason}`);
      if (down && !ev) {
        const start = reason === "OFFLINE" && m.last_seen_at ? new Date(m.last_seen_at) : new Date();
        await db.query(`INSERT INTO downtime_events (machine_id, reason, started_at) VALUES (?, ?, ?)`, [m.machine_id, reason, start]);
        if (reason === "OFFLINE") {
          await db.query(
            `INSERT INTO machine_alerts (machine_id, alert_type, message) VALUES (?, 'OFFLINE', ?)`,
            [m.machine_id, `Machine offline since ${start.toISOString().slice(0, 16).replace("T", " ")} UTC`]
          );
        }
        opened++;
      } else if (!down && ev) {
        await db.query(`UPDATE downtime_events SET ended_at=NOW() WHERE id=?`, [ev.id]);
        if (reason === "OFFLINE") {
          await db.query(
            `UPDATE machine_alerts SET is_resolved=1, resolved_at=NOW() WHERE machine_id=? AND alert_type='OFFLINE' AND is_resolved=0`,
            [m.machine_id]
          );
        }
        closed++;
      }
    }
  }
  // Machines that were switched off in the admin panel: close their open events
  await db.query(
    `UPDATE downtime_events d JOIN machines m ON m.machine_id = d.machine_id
     SET d.ended_at = NOW() WHERE d.ended_at IS NULL AND m.status <> 'ACTIVE'`
  );
  return { opened, closed };
}

/* ───────────── 2. monthly report ───────────── */

/* Interval helpers: arrays of [startMs, endMs] */
function merge(list) {
  const s = list.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [a, b] of s) {
    if (out.length && a <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], b);
    else out.push([a, b]);
  }
  return out;
}
function intersect(A, B) {
  const out = [];
  let i = 0;
  let j = 0;
  while (i < A.length && j < B.length) {
    const a = Math.max(A[i][0], B[j][0]);
    const b = Math.min(A[i][1], B[j][1]);
    if (b > a) out.push([a, b]);
    if (A[i][1] < B[j][1]) i++; else j++;
  }
  return out;
}
function subtract(A, B) {
  let out = A.map((x) => [...x]);
  for (const [bs, be] of B) {
    const next = [];
    for (const [as, ae] of out) {
      if (be <= as || bs >= ae) { next.push([as, ae]); continue; }
      if (bs > as) next.push([as, bs]);
      if (be < ae) next.push([be, ae]);
    }
    out = next;
  }
  return out;
}
const total = (list) => list.reduce((s, [a, b]) => s + (b - a), 0);

const timeToMin = (t) => {
  if (!t) return null;
  const [h, m] = String(t).split(":").map(Number);
  return h * 60 + (m || 0);
};

/* Office-hour windows (UTC ms) between from and to. */
function officeWindows(location, fromMs, toMs) {
  const openMin = timeToMin(location && location.open_time);
  const closeMin = timeToMin(location && location.close_time);
  const days = location && location.open_days
    ? new Set(String(location.open_days).split(",").map((s) => Number(s.trim())).filter(Boolean))
    : null;
  const windows = [];
  // walk local days
  const startLocal = toLocal(new Date(fromMs));
  let day = Date.UTC(startLocal.getUTCFullYear(), startLocal.getUTCMonth(), startLocal.getUTCDate()) - OFFSET_MIN * MIN;
  for (; day < toMs; day += 24 * 60 * MIN) {
    const weekday = ((new Date(day + OFFSET_MIN * MIN).getUTCDay() + 6) % 7) + 1; // 1=Mon … 7=Sun
    if (days && days.size && !days.has(weekday)) continue;
    let a = day;
    let b = day + 24 * 60 * MIN;
    if (openMin !== null && closeMin !== null) {
      a = day + openMin * MIN;
      b = day + (closeMin > openMin ? closeMin : closeMin + 24 * 60) * MIN;
    }
    windows.push([Math.max(a, fromMs), Math.min(b, toMs)]);
  }
  return merge(windows);
}

function penaltyFor(rules, uptime, target, ticketBreaches) {
  if (!rules) return 0;
  let amount = 0;
  if (uptime < target && Array.isArray(rules.tiers)) {
    for (const t of rules.tiers) {
      if (uptime < Number(t.below)) amount = Math.max(amount, Number(t.amount) || 0);
    }
  }
  if (Number(rules.per_ticket_breach_amount) > 0) amount += ticketBreaches * Number(rules.per_ticket_breach_amount);
  if (Number(rules.max_amount) > 0) amount = Math.min(amount, Number(rules.max_amount));
  return round2(amount);
}

function parseRules(raw) {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

async function computeMonth(machineId, month) {
  const { start, end, month: monthKey } = monthRange(month);
  const [[m]] = await db.query(
    `SELECT m.machine_id, m.contract_id, m.created_at, m.installed_at, l.open_time, l.close_time, l.open_days,
            c.sla_uptime_pct, c.penalty_rules, c.status AS contract_status
     FROM machines m
     LEFT JOIN locations l ON l.id = m.location_id
     LEFT JOIN contracts c ON c.id = m.contract_id
     WHERE m.machine_id=?`,
    [machineId]
  );
  if (!m) return null;
  const nowMs = Date.now();
  const installed = m.installed_at ? Date.parse(`${m.installed_at}T00:00:00Z`) - OFFSET_MIN * MIN : new Date(m.created_at).getTime();
  const fromMs = Math.max(start.getTime(), installed);
  const toMs = Math.min(end.getTime(), nowMs);

  let scheduled = [];
  let down = [];
  if (toMs > fromMs) {
    const [events] = await db.query(
      `SELECT started_at, ended_at, excluded FROM downtime_events
       WHERE machine_id=? AND started_at < ? AND (ended_at IS NULL OR ended_at > ?)`,
      [machineId, new Date(toMs), new Date(fromMs)]
    );
    const toIv = (e) => [new Date(e.started_at).getTime(), e.ended_at ? new Date(e.ended_at).getTime() : nowMs];
    const excluded = merge(events.filter((e) => e.excluded).map(toIv));
    scheduled = subtract(officeWindows(m, fromMs, toMs), excluded);
    down = intersect(scheduled, merge(events.filter((e) => !e.excluded).map(toIv)));
  }
  const scheduledMin = Math.round(total(scheduled) / MIN);
  const downMin = Math.round(total(down) / MIN);
  const uptime = scheduledMin > 0 ? ((scheduledMin - downMin) / scheduledMin) * 100 : 100;
  const target = m.sla_uptime_pct !== null && m.sla_uptime_pct !== undefined ? Number(m.sla_uptime_pct) : null;
  const rules = parseRules(m.penalty_rules);

  // Tickets raised for this machine in the month
  const respH = rules && Number(rules.ticket_response_hours) > 0 ? Number(rules.ticket_response_hours) : null;
  const resolH = rules && Number(rules.ticket_resolution_hours) > 0 ? Number(rules.ticket_resolution_hours) : null;
  const [tickets] = await db.query(
    `SELECT complained_at, first_response_at, resolved_at FROM support_tickets
     WHERE machine_id=? AND complained_at >= ? AND complained_at < ?`,
    [machineId, start, end]
  );
  const late = (from, to, hours) =>
    hours !== null && ((to ? new Date(to) : new Date(nowMs)) - new Date(from)) / 3600000 > hours;
  const respBreached = tickets.filter((t) => late(t.complained_at, t.first_response_at, respH)).length;
  const resolBreached = tickets.filter((t) => late(t.complained_at, t.resolved_at, resolH)).length;

  const breached = target !== null && m.contract_id && uptime < target;
  const penalty = m.contract_id ? penaltyFor(rules, uptime, target ?? 0, respBreached + resolBreached) : 0;
  return {
    machine_id: machineId,
    contract_id: m.contract_id || null,
    month: monthKey,
    scheduled_minutes: scheduledMin,
    downtime_minutes: downMin,
    uptime_pct: Math.round(uptime * 1000) / 1000,
    sla_target_pct: m.contract_id ? target : null,
    breached: breached ? 1 : 0,
    penalty_amount: penalty,
    tickets_total: tickets.length,
    tickets_response_breached: respBreached,
    tickets_resolution_breached: resolBreached,
  };
}

async function saveReport(r, isFinal = false) {
  await db.query(
    `INSERT INTO sla_reports
       (machine_id, contract_id, month, scheduled_minutes, downtime_minutes, uptime_pct, sla_target_pct, breached,
        penalty_amount, tickets_total, tickets_response_breached, tickets_resolution_breached, is_final, generated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())
     ON DUPLICATE KEY UPDATE contract_id=VALUES(contract_id), scheduled_minutes=VALUES(scheduled_minutes),
       downtime_minutes=VALUES(downtime_minutes), uptime_pct=VALUES(uptime_pct), sla_target_pct=VALUES(sla_target_pct),
       breached=VALUES(breached), penalty_amount=VALUES(penalty_amount), tickets_total=VALUES(tickets_total),
       tickets_response_breached=VALUES(tickets_response_breached),
       tickets_resolution_breached=VALUES(tickets_resolution_breached), is_final=VALUES(is_final), generated_at=NOW()`,
    [r.machine_id, r.contract_id, r.month, r.scheduled_minutes, r.downtime_minutes, r.uptime_pct, r.sla_target_pct,
     r.breached, r.penalty_amount, r.tickets_total, r.tickets_response_breached, r.tickets_resolution_breached, isFinal ? 1 : 0]
  );
}

/* Recompute one month for all live machines (or the given ones). */
async function generateMonth(month, { machineIds = null, isFinal = false } = {}) {
  const { end } = monthRange(month);
  const [rows] = machineIds && machineIds.length
    ? await db.query(`SELECT machine_id FROM machines WHERE machine_id IN (?)`, [machineIds])
    : await db.query(`SELECT machine_id FROM machines WHERE status='ACTIVE' AND created_at < ?`, [end]);
  let n = 0;
  for (const r of rows) {
    const report = await computeMonth(r.machine_id, month);
    if (report) { await saveReport(report, isFinal); n++; }
  }
  return n;
}

/* Daily: this month, and last month (final once we're past the 3rd). */
async function dailyReports() {
  const day = toLocal().getUTCDate();
  const a = await generateMonth(monthStart(0));
  const b = day <= 7 ? await generateMonth(monthStart(-1), { isFinal: day >= 3 }) : 0;
  return a + b;
}

module.exports = { trackDowntime, computeMonth, generateMonth, dailyReports, officeWindows, merge, intersect, subtract, penaltyFor };
