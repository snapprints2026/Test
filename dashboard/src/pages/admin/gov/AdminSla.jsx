// SLA & uptime: monthly uptime per machine (office hours only), penalties,
// and the downtime events behind them. Planned maintenance can be excluded.
import React, { useState } from "react";
import { Link } from "react-router-dom";
import { adminApi } from "../../../api/admin.api";
import { errMsg } from "../../../api/axiosClient";
import DashboardLayout from "../../../components/DashboardLayout";
import { PageHeader, Card, Table, Modal, Field, ErrorText, Pill, money, fmtDateTime, fmtMinutes, monthStartYmd, useLoad } from "../../../components/ui";

export function SlaTable({ reports, linkMachines = true }) {
  return (
    <Table head={["Machine", "Office", "Contract", "Scheduled", "Down", "Uptime", "Target", "Penalty", "Tickets late", ""]} empty="No reports for this month">
      {reports.map((r) => (
        <tr key={r.id}>
          <td className="table-td text-sm">
            {linkMachines ? <Link className="text-brand-600" to={`/admin/machines/${r.machine_id}`}>{r.machine_name || r.machine_id}</Link> : (r.machine_name || r.machine_id)}
            <span className="block text-xs text-gray-400">{r.machine_id}</span>
          </td>
          <td className="table-td text-xs">{r.organization_name || "—"}</td>
          <td className="table-td text-xs font-mono">{r.contract_no || "—"}</td>
          <td className="table-td text-xs">{fmtMinutes(r.scheduled_minutes)}</td>
          <td className="table-td text-xs">{fmtMinutes(r.downtime_minutes)}</td>
          <td className="table-td font-semibold">{Number(r.uptime_pct).toFixed(2)} %</td>
          <td className="table-td text-xs">{r.sla_target_pct !== null ? `${Number(r.sla_target_pct)} %` : "—"}</td>
          <td className="table-td">{r.breached ? <Pill color="red">{money(r.penalty_amount)}</Pill> : <span className="text-xs text-gray-400">—</span>}</td>
          <td className="table-td text-xs">{r.tickets_response_breached + r.tickets_resolution_breached} / {r.tickets_total}</td>
          <td className="table-td text-xs text-gray-400">{r.is_final ? "final" : "running"}</td>
        </tr>
      ))}
    </Table>
  );
}

export function DowntimeTable({ events, onToggle }) {
  return (
    <Table head={["Machine", "Reason", "From", "To", "Duration", "Counted", "Notes", ""]} empty="No downtime recorded">
      {events.map((e) => (
        <tr key={e.id}>
          <td className="table-td text-xs">{e.machine_name || e.machine_id}<span className="block text-gray-400">{e.machine_id}</span></td>
          <td className="table-td"><Pill color={e.reason === "MAINTENANCE" ? "blue" : e.reason === "OFFLINE" ? "red" : "amber"}>{e.reason.replace("_", " ")}</Pill></td>
          <td className="table-td text-xs whitespace-nowrap">{fmtDateTime(e.started_at)}</td>
          <td className="table-td text-xs whitespace-nowrap">{e.ended_at ? fmtDateTime(e.ended_at) : <span className="text-red-600 font-medium">still down</span>}</td>
          <td className="table-td text-xs">{fmtMinutes(e.minutes)}</td>
          <td className="table-td">{e.excluded ? <Pill>Excluded</Pill> : <Pill color="red">Counted</Pill>}</td>
          <td className="table-td text-xs text-gray-500">{e.notes || ""}</td>
          <td className="table-td text-right">{onToggle && <button className="text-xs text-brand-600" onClick={() => onToggle(e)}>{e.excluded ? "Count it" : "Exclude"}</button>}</td>
        </tr>
      ))}
    </Table>
  );
}

export default function AdminSla() {
  const [month, setMonth] = useState(monthStartYmd(0).slice(0, 7));
  const reports = useLoad(() => adminApi.getSla({ month }), [month]);
  const events = useLoad(() => adminApi.getDowntime({ month }), [month]);
  const machines = useLoad(() => adminApi.getMachineInfo(), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [maintOpen, setMaintOpen] = useState(false);

  const recompute = async () => {
    setBusy(true); setError("");
    try { await adminApi.generateSla(month); reports.reload(); } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  };
  const toggle = async (e) => {
    const notes = e.excluded ? e.notes : window.prompt("Why is this excused? (e.g. power cut in the office, planned maintenance)", e.notes || "");
    if (!e.excluded && notes === null) return;
    try { await adminApi.updateDowntime(e.id, { excluded: !e.excluded, notes }); events.reload(); } catch (err) { setError(errMsg(err)); }
  };

  return (
    <DashboardLayout>
      <PageHeader title="SLA & uptime" sub="Counted only during office hours (set on each machine's location). Reports refresh every night; the previous month becomes final on the 3rd.">
        <input type="month" className="input py-1.5 text-sm" style={{ width: "auto" }} value={month} onChange={(e) => setMonth(e.target.value)} />
        <button className="btn-secondary" onClick={() => setMaintOpen(true)}>+ Planned maintenance</button>
        <button className="btn-primary" onClick={recompute} disabled={busy}>{busy ? "Recomputing…" : "Recompute now"}</button>
      </PageHeader>
      <div className="mb-4"><ErrorText>{error}</ErrorText></div>
      <Card title={`Uptime — ${month}`} bodyClass="p-0" className="mb-6">
        <SlaTable reports={reports.data?.reports || []} />
      </Card>
      <Card title="Downtime events" bodyClass="p-0">
        <DowntimeTable events={events.data || []} onToggle={toggle} />
      </Card>
      {maintOpen && <MaintenanceModal machines={machines.data || []} onClose={(saved) => { setMaintOpen(false); if (saved) events.reload(); }} />}
    </DashboardLayout>
  );
}

function MaintenanceModal({ machines, onClose }) {
  const [f, setF] = useState({ machineId: "", startedAt: "", endedAt: "", notes: "Planned maintenance" });
  const [error, setError] = useState("");
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await adminApi.addMaintenance({ ...f, startedAt: new Date(f.startedAt).toISOString(), endedAt: new Date(f.endedAt).toISOString() });
      onClose(true);
    } catch (err) { setError(errMsg(err)); }
  };
  return (
    <Modal open title="Planned maintenance (not counted as downtime)" onClose={() => onClose(false)}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Machine">
          <select className="input" required value={f.machineId} onChange={set("machineId")}>
            <option value="">Choose…</option>
            {machines.map((m) => <option key={m.machine_id} value={m.machine_id}>{m.name || m.machine_id} ({m.machine_id})</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From"><input className="input" type="datetime-local" required value={f.startedAt} onChange={set("startedAt")} /></Field>
          <Field label="To"><input className="input" type="datetime-local" required value={f.endedAt} onChange={set("endedAt")} /></Field>
        </div>
        <Field label="Notes"><input className="input" value={f.notes} onChange={set("notes")} /></Field>
        <ErrorText>{error}</ErrorText>
        <button className="btn-primary">Save</button>
      </form>
    </Modal>
  );
}
