// Audit log: who did what, when, from where (append-only).
import React, { useState } from "react";
import { adminApi } from "../../../api/admin.api";
import DashboardLayout from "../../../components/DashboardLayout";
import { PageHeader, Card, Table, Pill, ErrorText, fmtDateTime, useLoad } from "../../../components/ui";

const ACTOR_COLOR = { ADMIN: "brand", VENDOR: "teal", OFFICER: "orange", DEVICE: "gray", SYSTEM: "gray", CUSTOMER: "violet" };

export default function AdminAudit() {
  const [f, setF] = useState({ actorType: "", action: "", machineId: "", jobId: "" });
  const [applied, setApplied] = useState(f);
  const [pages, setPages] = useState([]);
  const list = useLoad(() => adminApi.getAudit({ ...applied, limit: 100 }), [JSON.stringify(applied)]);
  const rows = [...(list.data || []), ...pages.flat()];
  const more = async () => {
    const last = rows[rows.length - 1];
    if (!last) return;
    const next = await adminApi.getAudit({ ...applied, limit: 100, before: last.id });
    setPages((p) => [...p, next]);
  };
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <DashboardLayout>
      <PageHeader title="Audit log" sub="Logins, price approvals, invoices, refunds, settings changes, file deletions — with the person and IP address." />
      <Card className="mb-4">
        <form className="grid grid-cols-2 sm:grid-cols-5 gap-3 items-end" onSubmit={(e) => { e.preventDefault(); setPages([]); setApplied(f); }}>
          <select className="input" value={f.actorType} onChange={set("actorType")}>
            <option value="">Anyone</option>
            {Object.keys(ACTOR_COLOR).map((a) => <option key={a}>{a}</option>)}
          </select>
          <input className="input" placeholder="Action contains… (e.g. INVOICE)" value={f.action} onChange={set("action")} />
          <input className="input" placeholder="Machine ID" value={f.machineId} onChange={set("machineId")} />
          <input className="input" placeholder="Job ID" value={f.jobId} onChange={set("jobId")} />
          <button className="btn-primary">Filter</button>
        </form>
      </Card>
      <ErrorText>{list.error}</ErrorText>
      <Card bodyClass="p-0">
        <Table head={["When", "Who", "Action", "Machine / job", "Details", "IP"]} empty={list.loading ? "Loading…" : "No entries"}>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="table-td text-xs whitespace-nowrap">{fmtDateTime(r.created_at)}</td>
              <td className="table-td text-xs"><Pill color={ACTOR_COLOR[r.actor_type]}>{r.actor_type}</Pill>{r.actor_name && <span className="block mt-0.5">{r.actor_name}</span>}</td>
              <td className="table-td font-mono text-xs">{r.action_type}</td>
              <td className="table-td text-xs font-mono">{r.machine_id || ""}{r.job_id && <span className="block text-gray-400">{r.job_id}</span>}</td>
              <td className="table-td text-xs text-gray-500 max-w-md truncate" title={r.details ? JSON.stringify(r.details) : ""}>{r.details ? JSON.stringify(r.details) : ""}</td>
              <td className="table-td text-xs text-gray-400">{r.ip || ""}</td>
            </tr>
          ))}
        </Table>
      </Card>
      {rows.length >= 100 && <button className="btn-secondary mt-4" onClick={more}>Load older</button>}
    </DashboardLayout>
  );
}
