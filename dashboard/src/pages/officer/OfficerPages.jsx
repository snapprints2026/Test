// Department officer portal — read-only views scoped to the officer's
// organisation tree (plus raising complaints). All numbers come from
// /api/officer/*, which filters by the offices the officer belongs to.
import React, { useState } from "react";
import { officerApi } from "../../api/officer.api";
import { downloadFile, errMsg } from "../../api/axiosClient";
import DashboardLayout from "../../components/DashboardLayout";
import RevenueChart from "../../components/RevenueChart";
import TicketsPanel from "../../components/TicketsPanel";
import StatusBadge from "../../components/StatusBadge";
import {
  PageHeader, Card, Table, Pill, Stat, ErrorText, JobTypeBadge, CONTRACT_TYPES,
  money, fmtDate, fmtDateTime, monthStartYmd, todayYmd, useLoad,
} from "../../components/ui";
import { SlaTable, DowntimeTable } from "../admin/gov/AdminSla";
import { RateTable } from "../admin/finance/AdminPricing";

function DateRange({ value, onChange }) {
  return (
    <>
      <input type="date" className="input py-1.5 text-sm" style={{ width: "auto" }} value={value.from} max={value.to} onChange={(e) => onChange({ ...value, from: e.target.value })} />
      <span className="text-gray-400 text-sm">to</span>
      <input type="date" className="input py-1.5 text-sm" style={{ width: "auto" }} value={value.to} min={value.from} onChange={(e) => onChange({ ...value, to: e.target.value })} />
    </>
  );
}

const thisMonth = () => ({ from: monthStartYmd(0), to: todayYmd() });

export function OfficerOverview() {
  const [range, setRange] = useState(thisMonth);
  const me = useLoad(() => officerApi.me(), []);
  const ov = useLoad(() => officerApi.getOverview(range), [range.from, range.to]);
  const d = ov.data || {};
  const t = d.totals || {};
  return (
    <DashboardLayout>
      <PageHeader
        title={me.data ? me.data.organization_name : "Overview"}
        sub={me.data ? `${me.data.name}${me.data.designation ? ` · ${me.data.designation}` : ""} · ${me.data.path || ""}` : ""}
      >
        <DateRange value={range} onChange={setRange} />
      </PageHeader>
      <ErrorText>{ov.error}</ErrorText>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Stat label="Orders completed" value={Number(t.orders || 0).toLocaleString("en-IN")} sub={`${Number(t.pages || 0).toLocaleString("en-IN")} pages`} />
        <Stat label="Paid by citizens" value={money(t.citizen_payments)} />
        <Stat label="Billed to department" value={money(t.department_billed)} sub="appears on the monthly invoice" />
        <Stat
          label="Machines online"
          value={`${d.machines?.online ?? 0} / ${d.machines?.active ?? 0}`}
          tone={d.machines && d.machines.online < d.machines.active ? "text-amber-600" : "text-green-700"}
        />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <Stat
          label="Uptime this month (office hours)"
          value={d.uptimeThisMonth !== null && d.uptimeThisMonth !== undefined ? `${d.uptimeThisMonth.toFixed(2)} %` : "—"}
          sub={d.slaBreachesThisMonth ? `${d.slaBreachesThisMonth} machine(s) below target` : "no SLA breaches"}
        />
        <Stat label="Open complaints" value={d.openTickets ?? 0} tone={d.openTickets ? "text-red-600" : "text-green-700"} />
        <Card title="By service">
          <div className="space-y-2">
            {(d.byType || []).length === 0 && <p className="text-sm text-gray-400">No orders in this range</p>}
            {(d.byType || []).map((r) => (
              <div key={r.job_type} className="flex items-center justify-between text-sm">
                <JobTypeBadge type={r.job_type} />
                <span>{r.orders} orders · {money(r.amount)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <Card title="Daily orders value">
        <RevenueChart data={d.daily || []} />
      </Card>
    </DashboardLayout>
  );
}

const GROUPS = { office: "Office", machine: "Machine", month: "Month", job_type: "Service" };

export function OfficerReports() {
  const [range, setRange] = useState(thisMonth);
  const [groupBy, setGroupBy] = useState("office");
  const [error, setError] = useState("");
  const usage = useLoad(() => officerApi.getUsage({ ...range, groupBy }), [range.from, range.to, groupBy]);
  const rows = usage.data?.rows || [];
  const sum = (k) => rows.reduce((a, r) => a + Number(r[k] || 0), 0);
  const csv = async () => {
    setError("");
    try { await downloadFile(officerApi.usageCsvPath({ ...range, groupBy }), `usage-${range.from}-${range.to}.csv`); }
    catch (err) { setError(errMsg(err)); }
  };
  return (
    <DashboardLayout>
      <PageHeader title="Usage reports" sub="Completed orders only. Download as CSV for the office records.">
        <select className="input py-1.5 text-sm" style={{ width: "auto" }} value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
          {Object.entries(GROUPS).map(([k, v]) => <option key={k} value={k}>By {v.toLowerCase()}</option>)}
        </select>
        <DateRange value={range} onChange={setRange} />
        <button className="btn-secondary" onClick={csv}>Download CSV</button>
      </PageHeader>
      <ErrorText>{usage.error || error}</ErrorText>
      <Card bodyClass="p-0">
        <Table head={[GROUPS[groupBy], "Orders", "Pages", "Prints", "Forms", "Photocopies", "Scans", "Citizen payments", "Department billed"]} empty={usage.loading ? "Loading…" : "No orders in this range"}>
          {rows.map((r) => (
            <tr key={r.group_key}>
              <td className="table-td text-sm font-medium">
                {groupBy === "job_type" ? <JobTypeBadge type={r.label} /> : r.label || "—"}
                {r.office_code && <span className="block text-xs text-gray-400">{r.office_code}</span>}
                {r.office && <span className="block text-xs text-gray-400">{r.office}</span>}
              </td>
              <td className="table-td">{r.orders}</td>
              <td className="table-td">{r.pages}</td>
              <td className="table-td text-xs">{r.prints}</td>
              <td className="table-td text-xs">{r.forms}</td>
              <td className="table-td text-xs">{r.copies}</td>
              <td className="table-td text-xs">{r.scans}</td>
              <td className="table-td">{money(r.citizen_payments)}</td>
              <td className="table-td">{money(r.department_billed)}</td>
            </tr>
          ))}
          {rows.length > 0 && (
            <tr className="bg-gray-50 font-semibold">
              <td className="table-td">Total</td>
              <td className="table-td">{sum("orders")}</td>
              <td className="table-td">{sum("pages")}</td>
              <td className="table-td text-xs">{sum("prints")}</td>
              <td className="table-td text-xs">{sum("forms")}</td>
              <td className="table-td text-xs">{sum("copies")}</td>
              <td className="table-td text-xs">{sum("scans")}</td>
              <td className="table-td">{money(sum("citizen_payments"))}</td>
              <td className="table-td">{money(sum("department_billed"))}</td>
            </tr>
          )}
        </Table>
      </Card>
    </DashboardLayout>
  );
}

export function OfficerMachines() {
  const list = useLoad(() => officerApi.getMachines(), []);
  return (
    <DashboardLayout>
      <PageHeader title="Machines" sub="Machines installed in your offices." />
      <ErrorText>{list.error}</ErrorText>
      <Card bodyClass="p-0">
        <Table head={["Machine", "Office", "Services", "Who pays", "Hours", "Today", "Uptime (month)", "Status"]} empty={list.loading ? "Loading…" : "No machines yet"}>
          {(list.data || []).map((m) => (
            <tr key={m.machine_id}>
              <td className="table-td text-sm font-medium">{m.name || m.machine_id}<span className="block text-xs text-gray-400">{m.machine_id}{m.asset_tag ? ` · asset ${m.asset_tag}` : ""}</span></td>
              <td className="table-td text-xs">{m.organization_name}{m.office_code && <span className="block text-gray-400">{m.office_code}</span>}</td>
              <td className="table-td"><div className="flex flex-wrap gap-1">{String(m.enabled_job_types || "PRINT").split(",").map((j) => <JobTypeBadge key={j} type={j} />)}</div></td>
              <td className="table-td text-xs">{m.billing_mode === "DEPARTMENT" ? "Department" : "Citizen"}</td>
              <td className="table-td text-xs">{m.open_time ? `${String(m.open_time).slice(0, 5)}–${String(m.close_time).slice(0, 5)}` : "24 × 7"}</td>
              <td className="table-td">{m.printed_today}</td>
              <td className="table-td">{m.uptime_month !== null ? `${Number(m.uptime_month).toFixed(2)} %` : "—"}</td>
              <td className="table-td">
                <StatusBadge status={m.status !== "ACTIVE" ? m.status : m.is_online ? "ONLINE" : "OFFLINE"} />
                {!!m.is_print_locked && <span className="block text-xs text-amber-600 mt-1">paper / service lock</span>}
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </DashboardLayout>
  );
}

export function OfficerSla() {
  const [month, setMonth] = useState(monthStartYmd(0).slice(0, 7));
  const reports = useLoad(() => officerApi.getSla({ month }), [month]);
  const events = useLoad(() => officerApi.getDowntime({ month }), [month]);
  return (
    <DashboardLayout>
      <PageHeader title="Uptime (SLA)" sub="Uptime counts office hours only. Planned maintenance agreed with the office is excluded.">
        <input type="month" className="input py-1.5 text-sm" style={{ width: "auto" }} value={month} onChange={(e) => setMonth(e.target.value)} />
      </PageHeader>
      <ErrorText>{reports.error || events.error}</ErrorText>
      <Card title="Monthly uptime" bodyClass="p-0" className="mb-6">
        <SlaTable reports={reports.data?.reports || []} linkMachines={false} />
      </Card>
      <Card title="Downtime events" bodyClass="p-0">
        <DowntimeTable events={events.data || []} />
      </Card>
    </DashboardLayout>
  );
}

const INV_STATUS = { DRAFT: "gray", ISSUED: "amber", PAID: "green", CANCELLED: "red" };
const SET_STATUS = { PENDING: "amber", APPROVED: "blue", PAID: "green", CANCELLED: "red" };

export function OfficerInvoices() {
  const invoices = useLoad(() => officerApi.getInvoices({ type: "DEPARTMENT" }), []);
  const settlements = useLoad(() => officerApi.getSettlements(), []);
  const [error, setError] = useState("");
  const pdf = async (i) => {
    setError("");
    try { await downloadFile(officerApi.invoicePdfPath(i.id), `${i.invoice_no}.pdf`); } catch (err) { setError(errMsg(err)); }
  };
  return (
    <DashboardLayout>
      <PageHeader title="Invoices & settlements" sub="GST invoices for department-paid usage, and revenue share paid to your office." />
      <ErrorText>{invoices.error || settlements.error || error}</ErrorText>
      <Card title="Invoices to the department" bodyClass="p-0" className="mb-6">
        <Table head={["Invoice", "Office", "Period", "Taxable", "GST", "Total", "Due", "Status", ""]} empty={invoices.loading ? "Loading…" : "No invoices"}>
          {(invoices.data || []).map((i) => (
            <tr key={i.id}>
              <td className="table-td font-mono text-xs">{i.invoice_no}<span className="block text-gray-400 font-sans">{fmtDate(i.issued_at)}</span></td>
              <td className="table-td text-sm">{i.organization_name || i.buyer_name}{i.contract_no && <span className="block text-xs text-gray-400 font-mono">{i.contract_no}</span>}</td>
              <td className="table-td text-xs whitespace-nowrap">{i.period_start ? `${fmtDate(i.period_start)} → ${fmtDate(i.period_end)}` : "—"}</td>
              <td className="table-td">{money(i.taxable_amount)}</td>
              <td className="table-td text-xs">{money(Number(i.cgst) + Number(i.sgst) + Number(i.igst))}</td>
              <td className="table-td font-semibold">{money(i.total)}</td>
              <td className="table-td text-xs">{fmtDate(i.due_date)}</td>
              <td className="table-td"><Pill color={INV_STATUS[i.status]}>{i.status}</Pill></td>
              <td className="table-td text-right"><button className="text-xs text-brand-600" onClick={() => pdf(i)}>PDF</button></td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card title="Revenue share to your office" bodyClass="p-0">
        <Table head={["Office", "Contract", "Period", "Citizen payments", "Share", "Status", "Reference"]} empty={settlements.loading ? "Loading…" : "No settlements"}>
          {(settlements.data || []).map((s) => (
            <tr key={s.id}>
              <td className="table-td text-sm">{s.organization_name}</td>
              <td className="table-td font-mono text-xs">{s.contract_no}</td>
              <td className="table-td text-xs whitespace-nowrap">{fmtDate(s.period_start)} → {fmtDate(s.period_end)}</td>
              <td className="table-td">{money(s.gross_revenue)}</td>
              <td className="table-td font-semibold">{money(s.share_amount)} <span className="text-xs text-gray-400 font-normal">({Number(s.share_pct)} %)</span></td>
              <td className="table-td"><Pill color={SET_STATUS[s.status]}>{s.status}</Pill></td>
              <td className="table-td text-xs">{s.reference || "—"}{s.paid_at && <span className="block text-gray-400">{fmtDateTime(s.paid_at)}</span>}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </DashboardLayout>
  );
}

export function OfficerContracts() {
  const contracts = useLoad(() => officerApi.getContracts(), []);
  const machines = useLoad(() => officerApi.getMachines(), []);
  const [machineId, setMachineId] = useState("");
  const rates = useLoad(() => (machineId ? officerApi.getRates(machineId) : Promise.resolve(null)), [machineId]);
  return (
    <DashboardLayout>
      <PageHeader title="Contracts & rates" />
      <ErrorText>{contracts.error}</ErrorText>
      <Card title="Contracts" bodyClass="p-0" className="mb-6">
        <Table head={["Contract", "Office", "Type", "GeM / PO", "Period", "Terms", "SLA", "Status"]} empty={contracts.loading ? "Loading…" : "No contracts"}>
          {(contracts.data || []).map((c) => (
            <tr key={c.id}>
              <td className="table-td font-mono text-xs">{c.contract_no}{c.title && <span className="block font-sans text-gray-500">{c.title}</span>}</td>
              <td className="table-td text-sm">{c.organization_name}</td>
              <td className="table-td text-xs">{CONTRACT_TYPES[c.contract_type]}</td>
              <td className="table-td text-xs">{c.gem_contract_no || "—"}{c.po_number && <span className="block text-gray-400">PO {c.po_number}</span>}</td>
              <td className="table-td text-xs whitespace-nowrap">{fmtDate(c.start_date)} → {c.end_date ? fmtDate(c.end_date) : "open"}</td>
              <td className="table-td text-xs">
                {c.revenue_share_pct !== null && <span className="block">Share {Number(c.revenue_share_pct)} %</span>}
                {c.rental_amount_monthly !== null && <span className="block">Rent {money(c.rental_amount_monthly)}/month</span>}
                {c.warranty_until && <span className="block text-gray-400">Warranty till {fmtDate(c.warranty_until)}</span>}
                {c.amc_until && <span className="block text-gray-400">AMC till {fmtDate(c.amc_until)}</span>}
              </td>
              <td className="table-td text-xs">{c.sla_uptime_pct !== null ? `${Number(c.sla_uptime_pct)} %` : "—"}</td>
              <td className="table-td"><Pill color={c.status === "ACTIVE" ? "green" : "gray"}>{c.status}</Pill></td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card
        title="Approved rates"
        actions={
          <select className="input py-1.5 text-sm" style={{ width: "auto" }} value={machineId} onChange={(e) => setMachineId(e.target.value)}>
            <option value="">Choose a machine…</option>
            {(machines.data || []).map((m) => <option key={m.machine_id} value={m.machine_id}>{m.name || m.machine_id} — {m.organization_name}</option>)}
          </select>
        }
        bodyClass="p-0"
      >
        {!machineId ? <p className="p-5 text-sm text-gray-400">Choose a machine to see the rates it charges today (GST included).</p>
          : rates.error ? <div className="p-5"><ErrorText>{rates.error}</ErrorText></div>
          : rates.data ? <RateTable table={rates.data.table} jobTypes={rates.data.jobTypes} />
          : <p className="p-5 text-sm text-gray-400">Loading…</p>}
      </Card>
    </DashboardLayout>
  );
}

export function OfficerTickets() {
  const machines = useLoad(() => officerApi.getMachines(), []);
  return (
    <DashboardLayout>
      <PageHeader title="Complaints" sub="Raise a complaint about a machine. Response and resolution times count towards the SLA." />
      <TicketsPanel api={officerApi} role="officer" machines={machines.data || []} />
    </DashboardLayout>
  );
}
