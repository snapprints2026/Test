// Invoices: GST receipts for citizen orders (automatic) and monthly invoices
// to departments (generated here), plus manual invoices.
import React, { useState } from "react";
import { adminApi } from "../../../api/admin.api";
import { errMsg, downloadFile } from "../../../api/axiosClient";
import { useAuth } from "../../../context/AuthContext";
import DashboardLayout from "../../../components/DashboardLayout";
import { PageHeader, Card, Table, Modal, Field, ErrorText, Pill, money, fmtDate, monthStartYmd, monthEndYmd, CONTRACT_TYPES, useLoad } from "../../../components/ui";

const TYPE_LABEL = { CUSTOMER_RECEIPT: "Citizen receipt", DEPARTMENT: "Department", MANUAL: "Manual" };
const STATUS_COLOR = { ISSUED: "amber", PAID: "green", CANCELLED: "gray" };

export default function AdminInvoices() {
  const { adminRole } = useAuth();
  const canEdit = ["SUPER_ADMIN", "ADMIN", "FINANCE"].includes(adminRole);
  const [filters, setFilters] = useState({ type: "DEPARTMENT", status: "" });
  const list = useLoad(() => adminApi.getInvoices(filters), [filters.type, filters.status]);
  const contracts = useLoad(() => adminApi.getContracts(), []);
  const [genOpen, setGenOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [error, setError] = useState("");

  const markPaid = async (i) => {
    const ref = window.prompt(`Payment reference for ${i.invoice_no} (UTR / cheque no.):`);
    if (ref === null) return;
    try { await adminApi.updateInvoice(i.id, { status: "PAID", paymentRef: ref }); list.reload(); } catch (err) { setError(errMsg(err)); }
  };
  const cancel = async (i) => {
    const reason = window.prompt(`Why cancel ${i.invoice_no}? (the number is kept, the invoice is marked cancelled)`);
    if (!reason) return;
    try { await adminApi.updateInvoice(i.id, { status: "CANCELLED", reason }); list.reload(); } catch (err) { setError(errMsg(err)); }
  };

  return (
    <DashboardLayout>
      <PageHeader title="Invoices" sub="Numbered per financial year (April–March): R = citizen receipts, D = department invoices, M = manual.">
        <select className="input py-1.5 text-sm" style={{ width: "auto" }} value={filters.type} onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}>
          <option value="">All types</option>
          {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="input py-1.5 text-sm" style={{ width: "auto" }} value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
          <option value="">Any status</option>
          {Object.keys(STATUS_COLOR).map((s) => <option key={s}>{s}</option>)}
        </select>
        {canEdit && <button className="btn-secondary" onClick={() => setManualOpen(true)}>+ Manual invoice</button>}
        {canEdit && <button className="btn-primary" onClick={() => setGenOpen(true)}>Generate department invoice</button>}
      </PageHeader>
      <div className="mb-4"><ErrorText>{error}</ErrorText></div>
      <Card bodyClass="p-0">
        <Table head={["Invoice", "Type", "Buyer", "Period", "Taxable", "GST", "Total", "Status", ""]} empty={list.loading ? "Loading…" : "No invoices"}>
          {(list.data || []).map((i) => (
            <tr key={i.id}>
              <td className="table-td font-mono text-xs">{i.invoice_no}<span className="block text-gray-400 font-sans">{fmtDate(i.issued_at)}</span></td>
              <td className="table-td text-xs">{TYPE_LABEL[i.invoice_type]}{i.is_tax_invoice ? "" : <span className="block text-gray-400">no GST</span>}</td>
              <td className="table-td text-sm">{i.organization_name || i.buyer_name}{i.contract_no && <span className="block text-xs text-gray-400 font-mono">{i.contract_no}</span>}{i.job_id && <span className="block text-xs text-gray-400">{i.machine_id}</span>}</td>
              <td className="table-td text-xs whitespace-nowrap">{i.period_start ? `${fmtDate(i.period_start)} → ${fmtDate(i.period_end)}` : "—"}</td>
              <td className="table-td text-sm">{money(i.taxable_amount)}</td>
              <td className="table-td text-xs">{money(Number(i.cgst) + Number(i.sgst) + Number(i.igst))}</td>
              <td className="table-td font-semibold">{money(i.total)}</td>
              <td className="table-td"><Pill color={STATUS_COLOR[i.status]}>{i.status}</Pill></td>
              <td className="table-td text-right whitespace-nowrap">
                <button className="text-xs text-brand-600 mr-2" onClick={() => downloadFile(adminApi.invoicePdfPath(i.id), `${i.invoice_no}.pdf`)}>PDF</button>
                {canEdit && i.status === "ISSUED" && <button className="text-xs text-green-700 mr-2" onClick={() => markPaid(i)}>Mark paid</button>}
                {canEdit && i.status !== "CANCELLED" && i.invoice_type !== "CUSTOMER_RECEIPT" && <button className="text-xs text-red-600" onClick={() => cancel(i)}>Cancel</button>}
              </td>
            </tr>
          ))}
        </Table>
      </Card>
      {genOpen && <GenerateInvoiceModal contracts={(contracts.data || []).filter((c) => c.contract_type !== "REVENUE_SHARE")} onClose={(saved) => { setGenOpen(false); if (saved) list.reload(); }} />}
      {manualOpen && <ManualInvoiceModal onClose={(saved) => { setManualOpen(false); if (saved) list.reload(); }} />}
    </DashboardLayout>
  );
}

export function GenerateInvoiceModal({ contracts, contractId, defaults = {}, onClose }) {
  const [f, setF] = useState({
    contractId: contractId || "", periodStart: defaults.periodStart || monthStartYmd(-1), periodEnd: defaults.periodEnd || monthEndYmd(-1),
    includeAmc: false, extraLines: [],
  });
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => { setPreview(null); setF((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value })); };
  const payload = () => ({ ...f, contractId: Number(f.contractId), extraLines: f.extraLines.filter((l) => l.description && l.rate !== "") });
  const doPreview = async (e) => {
    e?.preventDefault();
    setBusy(true); setError("");
    try { setPreview(await adminApi.generateInvoice({ ...payload(), preview: true })); } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  };
  const create = async () => {
    setBusy(true); setError("");
    try { await adminApi.generateInvoice(payload()); onClose(true); } catch (err) { setError(errMsg(err)); setBusy(false); }
  };
  const setLine = (i, k, v) => { setPreview(null); setF((x) => ({ ...x, extraLines: x.extraLines.map((l, j) => (j === i ? { ...l, [k]: v } : l)) })); };
  return (
    <Modal open title="Department invoice" onClose={() => onClose(false)} wide>
      <form onSubmit={doPreview} className="space-y-3">
        <p className="text-xs text-gray-500">Adds every printed order billed to the department (staff code), the monthly rental, AMC if ticked, and deducts SLA penalties for months in the period.</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Contract">
            <select className="input" required value={f.contractId} onChange={set("contractId")}>
              <option value="">Choose…</option>
              {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no} — {c.organization_name} ({CONTRACT_TYPES[c.contract_type]})</option>)}
            </select>
          </Field>
          <Field label="From"><input className="input" type="date" required value={f.periodStart} onChange={set("periodStart")} /></Field>
          <Field label="To"><input className="input" type="date" required value={f.periodEnd} onChange={set("periodEnd")} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.includeAmc} onChange={set("includeAmc")} /> Include the yearly AMC amount</label>
        <div>
          <p className="text-xs font-medium text-gray-600 mb-1">Extra lines (optional)</p>
          {f.extraLines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 mb-2">
              <input className="input col-span-7" placeholder="Description" value={l.description} onChange={(e) => setLine(i, "description", e.target.value)} />
              <input className="input col-span-2" type="number" placeholder="Qty" value={l.quantity} onChange={(e) => setLine(i, "quantity", e.target.value)} />
              <input className="input col-span-3" type="number" step="0.01" placeholder="Rate ₹ (negative = credit)" value={l.rate} onChange={(e) => setLine(i, "rate", e.target.value)} />
            </div>
          ))}
          <button type="button" className="text-xs text-brand-600" onClick={() => setF((x) => ({ ...x, extraLines: [...x.extraLines, { description: "", quantity: 1, rate: "" }] }))}>+ Add line</button>
        </div>
        <ErrorText>{error}</ErrorText>
        <button className="btn-secondary" disabled={busy}>{busy && !preview ? "Calculating…" : "Preview"}</button>
      </form>
      {preview && (
        <div className="mt-5 border-t border-gray-100 pt-4">
          <Table head={["Description", "Qty", "Rate", "Amount"]} empty="Nothing to invoice in this period">
            {preview.line_items.map((l, i) => (
              <tr key={i}>
                <td className="table-td text-sm">{l.description}</td>
                <td className="table-td text-xs">{l.quantity} {l.unit}</td>
                <td className="table-td text-xs">{money(l.rate)}</td>
                <td className="table-td">{money(l.amount)}</td>
              </tr>
            ))}
          </Table>
          <div className="text-right text-sm mt-3 space-y-0.5">
            {preview.tax?.isTax && <p className="text-gray-500">Taxable {money(preview.tax.taxable)} · GST {money(preview.tax.cgst + preview.tax.sgst + preview.tax.igst)}</p>}
            <p className="text-lg font-semibold">Total {money(preview.total)}</p>
          </div>
          <button className="btn-primary mt-3" onClick={create} disabled={busy || !(preview.total > 0)}>{busy ? "Creating…" : "Create invoice"}</button>
        </div>
      )}
    </Modal>
  );
}

function ManualInvoiceModal({ onClose }) {
  const orgs = useLoad(() => adminApi.getOrganizations(), []);
  const [f, setF] = useState({ organizationId: "", buyerName: "", buyerGstin: "", buyerAddress: "", placeOfSupply: "", notes: "", lines: [{ description: "", quantity: 1, rate: "" }] });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const pickOrg = (id) => {
    const o = (orgs.data || []).find((x) => x.id === Number(id));
    setF((x) => ({ ...x, organizationId: id, buyerName: o ? o.name : x.buyerName, buyerGstin: o?.gstin || x.buyerGstin,
      buyerAddress: o ? [o.address, o.city, o.state, o.pincode].filter(Boolean).join(", ") : x.buyerAddress, placeOfSupply: o?.state || x.placeOfSupply }));
  };
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError("");
    try { await adminApi.manualInvoice({ ...f, organizationId: f.organizationId ? Number(f.organizationId) : null }); onClose(true); }
    catch (err) { setError(errMsg(err)); setBusy(false); }
  };
  return (
    <Modal open title="Manual invoice" onClose={() => onClose(false)} wide>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Organisation (optional)">
            <select className="input" value={f.organizationId} onChange={(e) => pickOrg(e.target.value)}>
              <option value="">—</option>
              {(orgs.data || []).map((o) => <option key={o.id} value={o.id}>{o.path}</option>)}
            </select>
          </Field>
          <Field label="Buyer name"><input className="input" required value={f.buyerName} onChange={set("buyerName")} /></Field>
          <Field label="Buyer GSTIN"><input className="input" value={f.buyerGstin} onChange={set("buyerGstin")} /></Field>
          <Field label="Place of supply (state)"><input className="input" value={f.placeOfSupply} onChange={set("placeOfSupply")} /></Field>
        </div>
        <Field label="Buyer address"><input className="input" value={f.buyerAddress} onChange={set("buyerAddress")} /></Field>
        {f.lines.map((l, i) => (
          <div key={i} className="grid grid-cols-12 gap-2">
            <input className="input col-span-7" placeholder="Description" value={l.description} onChange={(e) => setF((x) => ({ ...x, lines: x.lines.map((y, j) => (j === i ? { ...y, description: e.target.value } : y)) }))} />
            <input className="input col-span-2" type="number" placeholder="Qty" value={l.quantity} onChange={(e) => setF((x) => ({ ...x, lines: x.lines.map((y, j) => (j === i ? { ...y, quantity: e.target.value } : y)) }))} />
            <input className="input col-span-3" type="number" step="0.01" placeholder="Rate ₹ (incl. GST)" value={l.rate} onChange={(e) => setF((x) => ({ ...x, lines: x.lines.map((y, j) => (j === i ? { ...y, rate: e.target.value } : y)) }))} />
          </div>
        ))}
        <button type="button" className="text-xs text-brand-600" onClick={() => setF((x) => ({ ...x, lines: [...x.lines, { description: "", quantity: 1, rate: "" }] }))}>+ Add line</button>
        <Field label="Notes"><input className="input" value={f.notes} onChange={set("notes")} /></Field>
        <ErrorText>{error}</ErrorText>
        <button className="btn-primary" disabled={busy}>{busy ? "Creating…" : "Create invoice"}</button>
      </form>
    </Modal>
  );
}
