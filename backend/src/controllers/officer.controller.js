// src/controllers/officer.controller.js
// Read-only department officer portal. Everything is limited to the
// officer's organisation and the organisations below it (req.staff.orgIds).
// Officers see usage and money totals — never citizens' phone numbers or files.
const db = require("../database/db");
const orgs = require("../services/org.service");
const machines = require("../services/machine.service");
const { isYmd, dayRange, localSql, today, monthStart } = require("../services/time.service");
const { priceTable } = require("../services/pricing.service");

const fail = (res, status, error) => res.status(status).json({ error });

function range(q) {
  const to = isYmd(q.to) ? q.to : today();
  const from = isYmd(q.from) ? q.from : monthStart(0);
  return { from, to, ...dayRange(from, to) };
}

/* GET /api/officer/me */
exports.me = async (req, res) => {
  const [[o]] = await db.query(
    `SELECT f.id, f.name, f.email, f.phone, f.designation, f.organization_id, g.name AS organization_name,
            g.office_code, g.segment, g.org_type
     FROM officers f JOIN organizations g ON g.id=f.organization_id WHERE f.id=?`,
    [req.staff.id]
  );
  res.json({ ...o, path: await orgs.orgPath(o.organization_id) });
};

/* GET /api/officer/organizations → the officer's tree */
exports.organizations = async (req, res) => {
  try {
    res.json(await orgs.listTree([req.staff.organizationId]));
  } catch (err) {
    console.error("OFFICER ORGS ERROR:", err);
    res.status(500).json({ error: "Failed to load offices" });
  }
};

/* GET /api/officer/overview?from&to */
exports.overview = async (req, res) => {
  try {
    const ids = req.staff.orgIds;
    if (!ids.length) return res.json({});
    const r = range(req.query);
    const [[totals]] = await db.query(
      `SELECT COUNT(*) AS orders,
              COALESCE(SUM(CASE WHEN job_type='SCAN' THEN total_pages ELSE total_pages*copies END),0) AS pages,
              COALESCE(SUM(CASE WHEN billing='CUSTOMER' THEN amount ELSE 0 END),0) AS citizen_payments,
              COALESCE(SUM(CASE WHEN billing='DEPARTMENT' THEN amount ELSE 0 END),0) AS department_billed
       FROM print_jobs WHERE organization_id IN (?) AND status='PRINTED' AND printed_at >= ? AND printed_at < ?`,
      [ids, r.start, r.end]
    );
    const [byType] = await db.query(
      `SELECT job_type, COUNT(*) AS orders, COALESCE(SUM(amount),0) AS amount
       FROM print_jobs WHERE organization_id IN (?) AND status='PRINTED' AND printed_at >= ? AND printed_at < ?
       GROUP BY job_type ORDER BY orders DESC`,
      [ids, r.start, r.end]
    );
    const [daily] = await db.query(
      `SELECT DATE(${localSql("printed_at")}) AS date, COUNT(*) AS orders, COALESCE(SUM(amount),0) AS revenue
       FROM print_jobs WHERE organization_id IN (?) AND status='PRINTED' AND printed_at >= ? AND printed_at < ?
       GROUP BY DATE(${localSql("printed_at")}) ORDER BY date`,
      [ids, r.start, r.end]
    );
    const [mrows] = await db.query(`SELECT machine_id, last_seen_at, status FROM machines WHERE organization_id IN (?)`, [ids]);
    const [[uptime]] = await db.query(
      `SELECT AVG(s.uptime_pct) AS avg_uptime, SUM(s.breached) AS breaches
       FROM sla_reports s JOIN machines m ON m.machine_id=s.machine_id
       WHERE m.organization_id IN (?) AND s.month=?`,
      [ids, monthStart(0)]
    );
    const [[tickets]] = await db.query(
      `SELECT COUNT(*) AS open FROM support_tickets t
       LEFT JOIN machines m ON m.machine_id=t.machine_id
       WHERE (t.organization_id IN (?) OR m.organization_id IN (?)) AND t.status NOT IN ('RESOLVED','CLOSED')`,
      [ids, ids]
    );
    res.json({
      from: r.from, to: r.to, totals, byType, daily,
      machines: {
        total: mrows.length,
        active: mrows.filter((m) => m.status === "ACTIVE").length,
        online: mrows.filter((m) => m.status === "ACTIVE" && machines.isRecent(m.last_seen_at)).length,
      },
      uptimeThisMonth: uptime.avg_uptime !== null ? Number(uptime.avg_uptime) : null,
      slaBreachesThisMonth: Number(uptime.breaches) || 0,
      openTickets: Number(tickets.open) || 0,
    });
  } catch (err) {
    console.error("OFFICER OVERVIEW ERROR:", err);
    res.status(500).json({ error: "Failed to load overview" });
  }
};

/* GET /api/officer/usage?from&to&groupBy=office|machine|month|job_type&format=csv */
exports.usage = async (req, res) => {
  try {
    const ids = req.staff.orgIds;
    const r = range(req.query);
    const groups = {
      office: { key: "o.id", label: "o.name", extra: "o.office_code AS office_code" },
      machine: { key: "pj.machine_id", label: "COALESCE(m.name, pj.machine_id)", extra: "o.name AS office" },
      month: { key: `DATE_FORMAT(${localSql("pj.printed_at")}, '%Y-%m')`, label: `DATE_FORMAT(${localSql("pj.printed_at")}, '%Y-%m')`, extra: "NULL AS extra" },
      job_type: { key: "pj.job_type", label: "pj.job_type", extra: "NULL AS extra" },
    };
    const g = groups[req.query.groupBy] || groups.office;
    const [rows] = ids.length ? await db.query(
      `SELECT ${g.key} AS group_key, ${g.label} AS label, ${g.extra},
              COUNT(*) AS orders,
              SUM(CASE WHEN pj.job_type='SCAN' THEN pj.total_pages ELSE pj.total_pages*pj.copies END) AS pages,
              SUM(CASE WHEN pj.job_type='PRINT' THEN 1 ELSE 0 END) AS prints,
              SUM(CASE WHEN pj.job_type='FORM' THEN 1 ELSE 0 END) AS forms,
              SUM(CASE WHEN pj.job_type='COPY' THEN 1 ELSE 0 END) AS copies,
              SUM(CASE WHEN pj.job_type='SCAN' THEN 1 ELSE 0 END) AS scans,
              COALESCE(SUM(CASE WHEN pj.billing='CUSTOMER' THEN pj.amount ELSE 0 END),0) AS citizen_payments,
              COALESCE(SUM(CASE WHEN pj.billing='DEPARTMENT' THEN pj.amount ELSE 0 END),0) AS department_billed
       FROM print_jobs pj
       LEFT JOIN organizations o ON o.id = pj.organization_id
       LEFT JOIN machines m ON m.machine_id = pj.machine_id
       WHERE pj.organization_id IN (?) AND pj.status='PRINTED' AND pj.printed_at >= ? AND pj.printed_at < ?
       GROUP BY ${g.key}, ${g.label}
       ORDER BY ${req.query.groupBy === "month" ? "group_key" : "orders DESC"}`,
      [ids, r.start, r.end]
    ) : [[]];

    if (req.query.format === "csv") {
      const head = ["Group", "Orders", "Pages", "Prints", "Forms", "Photocopies", "Scans", "Citizen payments (Rs)", "Department billed (Rs)"];
      const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const lines = [head.map(esc).join(",")].concat(rows.map((x) =>
        [x.label, x.orders, x.pages, x.prints, x.forms, x.copies, x.scans, x.citizen_payments, x.department_billed].map(esc).join(",")));
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="snapprints-usage-${r.from}-to-${r.to}.csv"`);
      return res.send("﻿" + lines.join("\r\n"));
    }
    res.json({ from: r.from, to: r.to, groupBy: req.query.groupBy || "office", rows });
  } catch (err) {
    console.error("OFFICER USAGE ERROR:", err);
    res.status(500).json({ error: "Failed to load usage" });
  }
};

/* GET /api/officer/machines */
exports.machines = async (req, res) => {
  try {
    const ids = req.staff.orgIds;
    const [rows] = ids.length ? await db.query(
      `SELECT m.machine_id, m.name, m.module, m.status, m.last_seen_at, m.is_print_locked, m.billing_mode,
              m.enabled_job_types, m.asset_tag, o.name AS organization_name, o.office_code, l.name AS location_name,
              l.open_time, l.close_time, c.contract_no, c.contract_type,
              (SELECT COUNT(*) FROM print_jobs p WHERE p.machine_id=m.machine_id AND p.status='PRINTED'
                 AND p.printed_at >= ?) AS printed_today,
              (SELECT uptime_pct FROM sla_reports s WHERE s.machine_id=m.machine_id AND s.month=?) AS uptime_month
       FROM machines m
       LEFT JOIN organizations o ON o.id=m.organization_id
       LEFT JOIN locations l ON l.id=m.location_id
       LEFT JOIN contracts c ON c.id=m.contract_id
       WHERE m.organization_id IN (?)
       ORDER BY o.name, m.machine_id`,
      [dayRange(today(), today()).start, monthStart(0), ids]
    ) : [[]];
    res.json(rows.map((m) => ({ ...m, is_online: m.status === "ACTIVE" && machines.isRecent(m.last_seen_at) })));
  } catch (err) {
    console.error("OFFICER MACHINES ERROR:", err);
    res.status(500).json({ error: "Failed to load machines" });
  }
};

/* GET /api/officer/contracts → contracts + approved rates per machine */
exports.contracts = async (req, res) => {
  try {
    const ids = req.staff.orgIds;
    const [rows] = ids.length ? await db.query(
      `SELECT c.id, c.contract_no, c.contract_type, c.title, c.gem_contract_no, c.po_number, c.start_date, c.end_date,
              c.warranty_until, c.amc_until, c.revenue_share_pct, c.rental_amount_monthly, c.sla_uptime_pct, c.status,
              o.name AS organization_name
       FROM contracts c JOIN organizations o ON o.id=c.organization_id
       WHERE c.organization_id IN (?) ORDER BY c.start_date DESC`,
      [ids]
    ) : [[]];
    res.json(rows);
  } catch (err) {
    console.error("OFFICER CONTRACTS ERROR:", err);
    res.status(500).json({ error: "Failed to load contracts" });
  }
};

/* GET /api/officer/rates?machineId → the rates a machine charges today */
exports.rates = async (req, res) => {
  try {
    const ctx = await machines.getContext(String(req.query.machineId || ""));
    if (!ctx || !req.staff.orgIds.includes(ctx.organization_id)) return fail(res, 404, "Machine not found");
    res.json({ machineId: ctx.machine_id, jobTypes: ctx.jobTypes, table: await priceTable(ctx, ctx.jobTypes) });
  } catch (err) {
    console.error("OFFICER RATES ERROR:", err);
    res.status(500).json({ error: "Failed to load rates" });
  }
};
