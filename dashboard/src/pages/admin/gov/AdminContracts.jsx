// Contracts: how an organisation pays — sale + AMC, revenue share, pay per use, rental.
import React, { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { adminApi } from "../../../api/admin.api";
import { errMsg } from "../../../api/axiosClient";
import DashboardLayout from "../../../components/DashboardLayout";
import { PageHeader, Card, Table, Modal, Field, ErrorText, Pill, OrgSelect, CONTRACT_TYPES, fmtDate, todayYmd, useLoad } from "../../../components/ui";

export const PENALTY_EXAMPLE = JSON.stringify(
  { tiers: [{ below: 98, amount: 1000 }, { below: 95, amount: 2500 }], max_amount: 5000, ticket_response_hours: 4, ticket_resolution_hours: 24 },
  null, 2
);

export function ContractForm({ initial = {}, orgs, vendors, onSubmit, submitLabel = "Save", isEdit = false }) {
  const [f, setF] = useState({
    contractNo: "", organizationId: null, vendorId: null, contractType: "REVENUE_SHARE", title: "", gemContractNo: "", poNumber: "",
    startDate: todayYmd(), endDate: "", warrantyUntil: "", amcUntil: "", amcAmount: "", rentalAmountMonthly: "",
    revenueSharePct: "", slaUptimePct: "98", billingCycle: "MONTHLY", status: "ACTIVE", penaltyRules: "", notes: "", ...initial,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = { ...f };
      for (const k of ["endDate", "warrantyUntil", "amcUntil", "amcAmount", "rentalAmountMonthly", "revenueSharePct"]) if (payload[k] === "") payload[k] = null;
      if (!payload.contractNo) delete payload.contractNo;
      await onSubmit(payload);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  const t = f.contractType;
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Organisation"><OrgSelect orgs={orgs} value={f.organizationId} required onChange={(v) => setF((x) => ({ ...x, organizationId: v }))} placeholder="— choose —" /></Field>
        <Field label="Type" hint={isEdit ? "Can only change while DRAFT" : undefined}>
          <select className="input" value={t} onChange={set("contractType")}>
            {Object.entries(CONTRACT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Contract no." hint={isEdit ? undefined : "Leave empty to number it automatically"}><input className="input" value={f.contractNo} onChange={set("contractNo")} /></Field>
        <Field label="Title"><input className="input" value={f.title || ""} onChange={set("title")} placeholder="Citizen print kiosks" /></Field>
        <Field label="GeM contract no."><input className="input" value={f.gemContractNo || ""} onChange={set("gemContractNo")} /></Field>
        <Field label="PO / work order no."><input className="input" value={f.poNumber || ""} onChange={set("poNumber")} /></Field>
        <Field label="Start date"><input className="input" type="date" required value={f.startDate || ""} onChange={set("startDate")} /></Field>
        <Field label="End date"><input className="input" type="date" value={f.endDate || ""} onChange={set("endDate")} /></Field>
        {t === "REVENUE_SHARE" && <Field label="Office's revenue share %"><input className="input" type="number" step="0.01" min="0" max="100" required value={f.revenueSharePct ?? ""} onChange={set("revenueSharePct")} /></Field>}
        {t === "RENTAL" && <Field label="Monthly rental (₹)"><input className="input" type="number" step="0.01" min="0" required value={f.rentalAmountMonthly ?? ""} onChange={set("rentalAmountMonthly")} /></Field>}
        {(t === "SALE" || t === "RENTAL") && <Field label="Warranty until"><input className="input" type="date" value={f.warrantyUntil || ""} onChange={set("warrantyUntil")} /></Field>}
        {t === "SALE" && <Field label="AMC until"><input className="input" type="date" value={f.amcUntil || ""} onChange={set("amcUntil")} /></Field>}
        {t === "SALE" && <Field label="AMC amount per year (₹)"><input className="input" type="number" step="0.01" min="0" value={f.amcAmount ?? ""} onChange={set("amcAmount")} /></Field>}
        <Field label="SLA uptime target %"><input className="input" type="number" step="0.01" min="0" max="100" value={f.slaUptimePct ?? ""} onChange={set("slaUptimePct")} /></Field>
        <Field label="Operator (vendor)">
          <select className="input" value={f.vendorId || ""} onChange={(e) => setF((x) => ({ ...x, vendorId: e.target.value ? Number(e.target.value) : null }))}>
            <option value="">— none —</option>
            {(vendors || []).map((v) => <option key={v.id} value={v.id}>{v.full_name}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select className="input" value={f.status} onChange={set("status")}>
            {["DRAFT", "ACTIVE", "EXPIRED", "TERMINATED"].map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
      </div>
      <Field label="SLA penalty rules (JSON, optional)" hint="Penalty = highest tier where uptime is below 'below'; capped at max_amount. Ticket hours are reported in SLA reports.">
        <textarea className="input font-mono text-xs" rows={5} value={f.penaltyRules || ""} onChange={set("penaltyRules")} placeholder={PENALTY_EXAMPLE} />
      </Field>
      <Field label="Notes"><textarea className="input" rows={2} value={f.notes || ""} onChange={set("notes")} /></Field>
      <ErrorText>{error}</ErrorText>
      <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : submitLabel}</button>
    </form>
  );
}

export default function AdminContracts() {
  const [params] = useSearchParams();
  const list = useLoad(() => adminApi.getContracts(), []);
  const orgs = useLoad(() => adminApi.getOrganizations(), []);
  const vendors = useLoad(() => adminApi.getVendors(), []);
  const [creating, setCreating] = useState(!!params.get("org"));

  return (
    <DashboardLayout>
      <PageHeader title="Contracts" sub="GeM / PO details, revenue share, rentals, AMC and SLA targets.">
        <button className="btn-primary" onClick={() => setCreating(true)}>+ New contract</button>
      </PageHeader>
      <Card bodyClass="p-0">
        <Table head={["Contract", "Organisation", "Type", "GeM / PO", "Period", "SLA", "Machines", "Status"]} empty={list.loading ? "Loading…" : "No contracts yet"}>
          {(list.data || []).map((c) => (
            <tr key={c.id}>
              <td className="table-td"><Link className="text-brand-600 font-mono text-xs" to={`/admin/contracts/${c.id}`}>{c.contract_no}</Link><span className="block text-xs text-gray-400">{c.title}</span></td>
              <td className="table-td text-sm">{c.organization_name}{c.office_code ? <span className="text-xs text-gray-400"> ({c.office_code})</span> : null}</td>
              <td className="table-td text-xs">
                {CONTRACT_TYPES[c.contract_type]}
                {c.contract_type === "REVENUE_SHARE" && <span className="block text-gray-400">{Number(c.revenue_share_pct)} % to office</span>}
                {c.contract_type === "RENTAL" && <span className="block text-gray-400">₹{Number(c.rental_amount_monthly).toLocaleString("en-IN")}/month</span>}
              </td>
              <td className="table-td text-xs font-mono">{c.gem_contract_no || "—"}<span className="block">{c.po_number || ""}</span></td>
              <td className="table-td text-xs whitespace-nowrap">{fmtDate(c.start_date)} → {c.end_date ? fmtDate(c.end_date) : "open"}</td>
              <td className="table-td text-xs">{Number(c.sla_uptime_pct)} %</td>
              <td className="table-td">{c.machine_count}</td>
              <td className="table-td"><Pill color={c.status === "ACTIVE" ? "green" : c.status === "DRAFT" ? "amber" : "gray"}>{c.status}</Pill></td>
            </tr>
          ))}
        </Table>
      </Card>
      <Modal open={creating} title="New contract" onClose={() => setCreating(false)} wide>
        <ContractForm
          orgs={orgs.data}
          vendors={vendors.data}
          initial={{ organizationId: params.get("org") ? Number(params.get("org")) : null }}
          submitLabel="Create contract"
          onSubmit={async (f) => { await adminApi.createContract(f); setCreating(false); list.reload(); }}
        />
      </Modal>
    </DashboardLayout>
  );
}
