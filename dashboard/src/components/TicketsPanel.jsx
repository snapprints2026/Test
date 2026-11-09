// Support tickets — the same screen for admin (all), vendors (their machines)
// and officers (their offices). `api` = { getTickets, getTicket, createTicket, updateTicket }.
import React, { useState } from "react";
import { Card, Field, Modal, Pill, Table, ErrorText, fmtDateTime, fmtMinutes, useLoad } from "./ui";
import { errMsg } from "../api/axiosClient";

const STATUS_COLOR = { OPEN: "red", ACKNOWLEDGED: "amber", IN_PROGRESS: "blue", RESOLVED: "green", CLOSED: "gray" };
const PRIORITY_COLOR = { LOW: "gray", NORMAL: "blue", HIGH: "amber", CRITICAL: "red" };
const CATEGORIES = { MACHINE_DOWN: "Machine down", PAPER_TONER: "Paper / toner", PRINT_QUALITY: "Print quality", PAYMENT: "Payment", REFUND: "Refund", OTHER: "Other" };
const ALL_STATUSES = ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED", "CLOSED"];

export default function TicketsPanel({ api, role, machines = [], canCreate = true }) {
  const [filter, setFilter] = useState("ACTIVE");
  const list = useLoad(() => api.getTickets(filter === "ALL" ? undefined : filter), [filter]);
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(false);

  return (
    <>
      <Card
        title="Support tickets"
        bodyClass="p-0"
        actions={
          <>
            <select className="input py-1.5 text-sm" style={{ width: "auto" }} value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="ACTIVE">Open (not resolved)</option>
              <option value="ALL">All</option>
              {ALL_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
            </select>
            {canCreate && <button className="btn-primary" onClick={() => setCreating(true)}>+ New ticket</button>}
          </>
        }
      >
        {list.error && <div className="p-4"><ErrorText>{list.error}</ErrorText></div>}
        <Table head={["Ticket", "Subject", "Machine / office", "Priority", "Status", "Raised", "Response", "Resolution"]} empty={list.loading ? "Loading…" : "No tickets"}>
          {(list.data || []).map((t) => (
            <tr key={t.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setOpenId(t.id)}>
              <td className="table-td font-mono text-xs">{t.ticket_no}</td>
              <td className="table-td">
                <span className="font-medium">{t.subject}</span>
                <span className="block text-xs text-gray-400">{CATEGORIES[t.category]} · by {t.raised_by_type.toLowerCase()}</span>
              </td>
              <td className="table-td text-gray-500 text-xs">{t.machine_name || t.machine_id || "—"}{t.org_name ? <span className="block">{t.org_name}</span> : null}</td>
              <td className="table-td"><Pill color={PRIORITY_COLOR[t.priority]}>{t.priority}</Pill></td>
              <td className="table-td"><Pill color={STATUS_COLOR[t.status]}>{t.status.replace("_", " ")}</Pill></td>
              <td className="table-td text-xs text-gray-500 whitespace-nowrap">{fmtDateTime(t.complained_at)}</td>
              <td className="table-td text-xs">{t.response_minutes !== null ? fmtMinutes(t.response_minutes) : <span className="text-amber-600">waiting</span>}</td>
              <td className="table-td text-xs">{t.resolution_minutes !== null ? fmtMinutes(t.resolution_minutes) : "—"}</td>
            </tr>
          ))}
        </Table>
      </Card>

      {openId && <TicketModal api={api} role={role} id={openId} onClose={() => { setOpenId(null); list.reload(); }} />}
      {creating && (
        <NewTicketModal api={api} machines={machines} onClose={(created) => { setCreating(false); if (created) list.reload(); }} />
      )}
    </>
  );
}

function TicketModal({ api, role, id, onClose }) {
  const t = useLoad(() => api.getTicket(id), [id]);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const statuses = role === "officer" ? ["CLOSED", "OPEN"] : ALL_STATUSES;

  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.updateTicket(id, { message: message || undefined, status: status || undefined, priority: role === "admin" && priority ? priority : undefined });
      setMessage(""); setStatus(""); setPriority("");
      await t.reload();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const d = t.data;
  return (
    <Modal open title={d ? `${d.ticket_no} — ${d.subject}` : "Ticket"} onClose={onClose} wide>
      {!d ? <p className="text-sm text-gray-400">{t.error || "Loading…"}</p> : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 items-center text-xs text-gray-500">
            <Pill color={STATUS_COLOR[d.status]}>{d.status.replace("_", " ")}</Pill>
            <Pill color={PRIORITY_COLOR[d.priority]}>{d.priority}</Pill>
            <span>{CATEGORIES[d.category]}</span>
            {d.machine_id && <span>· {d.machine_name || d.machine_id}</span>}
            {d.org_name && <span>· {d.org_name}</span>}
            {d.contact_phone && <span>· call back {d.contact_phone}</span>}
          </div>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <div className="card p-3"><p className="text-gray-400">Raised</p><p className="font-medium">{fmtDateTime(d.complained_at)}</p></div>
            <div className="card p-3"><p className="text-gray-400">First response</p><p className="font-medium">{d.first_response_at ? `${fmtMinutes(d.response_minutes)} after` : "—"}</p></div>
            <div className="card p-3"><p className="text-gray-400">Resolved</p><p className="font-medium">{d.resolved_at ? `${fmtMinutes(d.resolution_minutes)} after` : "—"}</p></div>
          </div>
          <ol className="space-y-3 max-h-80 overflow-y-auto">
            {d.updates.map((u) => (
              <li key={u.id} className="border-l-2 border-gray-200 pl-3">
                <p className="text-xs text-gray-400">
                  {fmtDateTime(u.created_at)} · {u.author_name || u.author_type.toLowerCase()}
                  {u.status_to && <> · <span className="font-medium text-gray-600">{u.status_from ? `${u.status_from} → ` : ""}{u.status_to}</span></>}
                </p>
                {u.message && <p className="text-sm text-gray-800 whitespace-pre-wrap">{u.message}</p>}
              </li>
            ))}
          </ol>
          <form onSubmit={send} className="space-y-3 border-t border-gray-100 pt-4">
            <Field label="Reply">
              <textarea className="input" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Change status">
                <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">— keep {d.status} —</option>
                  {statuses.filter((s) => s !== d.status).map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                </select>
              </Field>
              {role === "admin" && (
                <Field label="Priority">
                  <select className="input" value={priority} onChange={(e) => setPriority(e.target.value)}>
                    <option value="">— keep {d.priority} —</option>
                    {["LOW", "NORMAL", "HIGH", "CRITICAL"].map((p) => <option key={p}>{p}</option>)}
                  </select>
                </Field>
              )}
            </div>
            <ErrorText>{error}</ErrorText>
            <button className="btn-primary" disabled={busy || (!message && !status && !priority)}>{busy ? "Saving…" : "Send update"}</button>
          </form>
        </div>
      )}
    </Modal>
  );
}

function NewTicketModal({ api, machines, onClose }) {
  const [form, setForm] = useState({ machineId: "", category: "MACHINE_DOWN", priority: "NORMAL", subject: "", description: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.createTicket({ ...form, machineId: form.machineId || undefined });
      onClose(true);
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  };
  return (
    <Modal open title="New support ticket" onClose={() => onClose(false)}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Machine">
          <select className="input" value={form.machineId} onChange={set("machineId")}>
            <option value="">— not about one machine —</option>
            {machines.map((m) => <option key={m.machine_id} value={m.machine_id}>{m.name || m.machine_id} ({m.machine_id})</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <select className="input" value={form.category} onChange={set("category")}>
              {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Priority">
            <select className="input" value={form.priority} onChange={set("priority")}>
              {["LOW", "NORMAL", "HIGH", "CRITICAL"].map((p) => <option key={p}>{p}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Subject"><input className="input" required maxLength={200} value={form.subject} onChange={set("subject")} /></Field>
        <Field label="Details"><textarea className="input" rows={4} value={form.description} onChange={set("description")} /></Field>
        <ErrorText>{error}</ErrorText>
        <button className="btn-primary" disabled={busy}>{busy ? "Creating…" : "Create ticket"}</button>
      </form>
    </Modal>
  );
}
