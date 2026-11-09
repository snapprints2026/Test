// Pricing rules: approved per-unit rates with an approval trail.
// New rule (PENDING) → approve with the office order no. (ACTIVE) → retire.
import React, { useMemo, useState } from "react";
import { adminApi } from "../../../api/admin.api";
import { errMsg } from "../../../api/axiosClient";
import { useAuth } from "../../../context/AuthContext";
import DashboardLayout from "../../../components/DashboardLayout";
import { PageHeader, Card, Table, Modal, Field, ErrorText, Pill, fmtDate, fmtDateTime, todayYmd, useLoad } from "../../../components/ui";

const STATUS_COLOR = { PENDING: "amber", ACTIVE: "green", RETIRED: "gray", REJECTED: "red" };
const JT = { ANY: "Any service", PRINT: "Print", FORM: "Form", COPY: "Photocopy", SCAN: "Scan" };
const COL = { any: "Any", bw: "B&W", color: "Colour" };
const SIDE = { any: "Any", single: "Single", duplex: "Double-sided" };

export default function AdminPricing() {
  const { adminRole } = useAuth();
  const canEdit = ["SUPER_ADMIN", "ADMIN", "FINANCE"].includes(adminRole);
  const [status, setStatus] = useState("");
  const rules = useLoad(() => adminApi.getPricingRules({ status }), [status]);
  const contracts = useLoad(() => adminApi.getContracts(), []);
  const machines = useLoad(() => adminApi.getMachineInfo(), []);
  const [creating, setCreating] = useState(false);
  const [previewId, setPreviewId] = useState("");
  const preview = useLoad(() => (previewId ? adminApi.previewPrices(previewId) : Promise.resolve(null)), [previewId]);
  const [error, setError] = useState("");

  const act = async (fn) => { setError(""); try { await fn(); rules.reload(); if (previewId) preview.reload(); } catch (err) { setError(errMsg(err)); } };
  const approve = (r) => {
    const ref = window.prompt("Approval reference (office order / letter no.):", r.approval_ref || "");
    if (ref) act(() => adminApi.approvePricingRule(r.id, ref));
  };

  return (
    <DashboardLayout>
      <PageHeader title="Pricing rules" sub="The most specific active rule wins: machine › contract › global, then the rule matching more options. Without a rule: B&W ₹2/₹4 (double-sided sheet), colour ₹5/₹10, scan ₹3/page.">
        <select className="input py-1.5 text-sm" style={{ width: "auto" }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {Object.keys(STATUS_COLOR).map((s) => <option key={s}>{s}</option>)}
        </select>
        {canEdit && <button className="btn-primary" onClick={() => setCreating(true)}>+ New rate</button>}
      </PageHeader>
      <div className="mb-4"><ErrorText>{error}</ErrorText></div>

      <Card bodyClass="p-0" className="mb-6">
        <Table head={["Scope", "Service", "Colour", "Paper", "Sides", "Rate", "Effective", "Approval", "Status", ""]} empty={rules.loading ? "Loading…" : "No rules — default prices apply"}>
          {(rules.data || []).map((r) => (
            <tr key={r.id}>
              <td className="table-td text-xs">
                <span className="font-medium">{r.scope}</span>
                <span className="block text-gray-400">{r.scope === "CONTRACT" ? `${r.contract_no} · ${r.organization_name}` : r.scope === "MACHINE" ? `${r.machine_name || ""} ${r.machine_id}` : "all machines"}</span>
              </td>
              <td className="table-td text-xs">{JT[r.job_type]}</td>
              <td className="table-td text-xs">{COL[r.color]}</td>
              <td className="table-td text-xs">{r.paper_size === "any" ? "Any" : r.paper_size}</td>
              <td className="table-td text-xs">{SIDE[r.print_side]}</td>
              <td className="table-td font-semibold">₹{Number(r.rate).toLocaleString("en-IN")}</td>
              <td className="table-td text-xs whitespace-nowrap">{fmtDate(r.effective_from)}{r.effective_to ? ` → ${fmtDate(r.effective_to)}` : ""}</td>
              <td className="table-td text-xs">
                {r.approval_ref || "—"}
                {r.approved_by_name && <span className="block text-gray-400">{r.approved_by_name}, {fmtDateTime(r.approved_at)}</span>}
                {!r.approved_by_name && r.created_by_name && <span className="block text-gray-400">created by {r.created_by_name}</span>}
              </td>
              <td className="table-td"><Pill color={STATUS_COLOR[r.status]}>{r.status}</Pill></td>
              <td className="table-td text-right whitespace-nowrap">
                {canEdit && r.status === "PENDING" && <>
                  <button className="text-xs text-green-700 mr-2" onClick={() => approve(r)}>Approve</button>
                  <button className="text-xs text-red-600" onClick={() => act(() => adminApi.rejectPricingRule(r.id))}>Reject</button>
                </>}
                {canEdit && r.status === "ACTIVE" && <button className="text-xs text-gray-600" onClick={() => window.confirm("Retire this rate? Prices fall back to the next matching rule.") && act(() => adminApi.retirePricingRule(r.id))}>Retire</button>}
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="What does a machine charge today?" actions={
        <select className="input py-1.5 text-sm" style={{ width: "auto" }} value={previewId} onChange={(e) => setPreviewId(e.target.value)}>
          <option value="">Choose a machine…</option>
          {(machines.data || []).map((m) => <option key={m.machine_id} value={m.machine_id}>{m.name || m.machine_id} ({m.machine_id})</option>)}
        </select>
      }>
        {!previewId ? <p className="text-sm text-gray-400">Pick a machine to see its rates per page (or per sheet when double-sided).</p>
          : preview.data ? <RateTable table={preview.data.table} jobTypes={preview.data.jobTypes} /> : <p className="text-sm text-gray-400">Loading…</p>}
      </Card>

      {creating && <NewRuleModal contracts={contracts.data || []} machines={machines.data || []} onClose={(saved) => { setCreating(false); if (saved) rules.reload(); }} />}
    </DashboardLayout>
  );
}

export function RateTable({ table, jobTypes }) {
  const rows = useMemo(() => {
    const out = [];
    for (const jt of jobTypes || Object.keys(table || {})) {
      for (const color of ["bw", "color"]) {
        const sides = table?.[jt]?.[color] || {};
        for (const side of Object.keys(sides)) out.push({ jt, color, side, a4: sides[side].A4, a3: sides[side].A3 });
      }
    }
    return out;
  }, [table, jobTypes]);
  return (
    <Table head={["Service", "Colour", "Sides", "A4", "A3"]}>
      {rows.map((r) => (
        <tr key={`${r.jt}${r.color}${r.side}`}>
          <td className="table-td text-xs">{JT[r.jt]}</td>
          <td className="table-td text-xs">{COL[r.color]}</td>
          <td className="table-td text-xs">{r.jt === "SCAN" ? "per page scanned" : SIDE[r.side]}</td>
          <td className="table-td">₹{r.a4}</td>
          <td className="table-td">{r.jt === "SCAN" ? "—" : `₹${r.a3}`}</td>
        </tr>
      ))}
    </Table>
  );
}

function NewRuleModal({ contracts, machines, onClose }) {
  const [f, setF] = useState({ scope: "CONTRACT", contractId: "", machineId: "", jobType: "ANY", color: "bw", paperSize: "any", printSide: "any", rate: "", effectiveFrom: todayYmd(), notes: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try { await adminApi.createPricingRule({ ...f, rate: Number(f.rate) }); onClose(true); }
    catch (err) { setError(errMsg(err)); setBusy(false); }
  };
  return (
    <Modal open title="New rate (needs approval)" onClose={() => onClose(false)}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Applies to">
            <select className="input" value={f.scope} onChange={set("scope")}>
              <option value="GLOBAL">All machines</option><option value="CONTRACT">One contract</option><option value="MACHINE">One machine</option>
            </select>
          </Field>
          {f.scope === "CONTRACT" && <Field label="Contract">
            <select className="input" required value={f.contractId} onChange={set("contractId")}>
              <option value="">Choose…</option>
              {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no} — {c.organization_name}</option>)}
            </select>
          </Field>}
          {f.scope === "MACHINE" && <Field label="Machine">
            <select className="input" required value={f.machineId} onChange={set("machineId")}>
              <option value="">Choose…</option>
              {machines.map((m) => <option key={m.machine_id} value={m.machine_id}>{m.name || m.machine_id} ({m.machine_id})</option>)}
            </select>
          </Field>}
          <Field label="Service"><select className="input" value={f.jobType} onChange={set("jobType")}>{Object.entries(JT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Colour"><select className="input" value={f.color} onChange={set("color")}>{Object.entries(COL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Paper"><select className="input" value={f.paperSize} onChange={set("paperSize")}><option value="any">Any</option><option>A4</option><option>A3</option></select></Field>
          <Field label="Sides"><select className="input" value={f.printSide} onChange={set("printSide")}>{Object.entries(SIDE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Rate (₹ per unit)" hint="Unit = page; sheet when double-sided; page scanned for scans">
            <input className="input" type="number" min="0" step="0.01" required value={f.rate} onChange={set("rate")} />
          </Field>
          <Field label="Effective from"><input className="input" type="date" value={f.effectiveFrom} onChange={set("effectiveFrom")} /></Field>
        </div>
        <Field label="Notes"><input className="input" value={f.notes} onChange={set("notes")} /></Field>
        <ErrorText>{error}</ErrorText>
        <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Create (pending approval)"}</button>
      </form>
    </Modal>
  );
}
