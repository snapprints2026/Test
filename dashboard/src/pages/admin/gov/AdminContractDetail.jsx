// One contract: terms, linked machines, invoices, settlements and SLA.
import React, { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { adminApi } from "../../../api/admin.api";
import { errMsg, downloadFile } from "../../../api/axiosClient";
import DashboardLayout from "../../../components/DashboardLayout";
import ModuleBadge from "../../../components/ModuleBadge";
import { PageHeader, Card, Table, Modal, Field, ErrorText, Pill, Stat, money, fmtDate, CONTRACT_TYPES, monthStartYmd, monthEndYmd, useLoad } from "../../../components/ui";
import { ContractForm } from "./AdminContracts";
import { GenerateInvoiceModal } from "../finance/AdminInvoices";
import { GenerateSettlementModal } from "../finance/AdminSettlements";

export default function AdminContractDetail() {
  const { contractId } = useParams();
  const d = useLoad(() => adminApi.getContract(contractId), [contractId]);
  const orgs = useLoad(() => adminApi.getOrganizations(), []);
  const vendors = useLoad(() => adminApi.getVendors(), []);
  const allMachines = useLoad(() => adminApi.getMachineInfo(), []);
  const [editing, setEditing] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [invOpen, setInvOpen] = useState(false);
  const [setlOpen, setSetlOpen] = useState(false);
  const [error, setError] = useState("");

  if (!d.data) return <DashboardLayout><p className="text-sm text-gray-400">{d.error || "Loading…"}</p></DashboardLayout>;
  const { contract: c, machines, invoices, settlements, sla, usage } = d.data;

  const detach = async (m) => {
    if (!window.confirm(`Remove ${m.machine_id} from this contract?`)) return;
    try { await adminApi.detachMachine(c.id, m.machine_id); d.reload(); } catch (err) { setError(errMsg(err)); }
  };

  return (
    <DashboardLayout>
      <Link to="/admin/contracts" className="text-sm text-gray-500 hover:text-gray-700">← Contracts</Link>
      <PageHeader title={`${c.contract_no}${c.title ? ` — ${c.title}` : ""}`} sub={`${c.organization_name} · ${CONTRACT_TYPES[c.contract_type]}`}>
        <Pill color={c.status === "ACTIVE" ? "green" : "gray"}>{c.status}</Pill>
        <button className="btn-secondary" onClick={() => setEditing(true)}>Edit</button>
        {c.contract_type !== "REVENUE_SHARE" && <button className="btn-primary" onClick={() => setInvOpen(true)}>Generate invoice</button>}
        {c.contract_type === "REVENUE_SHARE" && <button className="btn-primary" onClick={() => setSetlOpen(true)}>Generate settlement</button>}
      </PageHeader>
      <ErrorText>{error}</ErrorText>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Stat label="Printed orders" value={usage.orders} />
        <Stat label="Citizen payments" value={money(usage.customer_revenue)} tone="text-green-700" />
        <Stat label="Billed to department" value={money(usage.department_billed)} />
        <Stat label="SLA target" value={`${Number(c.sla_uptime_pct)} %`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <Card title="Terms">
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-gray-500">GeM contract</dt><dd className="font-mono">{c.gem_contract_no || "—"}</dd>
            <dt className="text-gray-500">PO / work order</dt><dd className="font-mono">{c.po_number || "—"}</dd>
            <dt className="text-gray-500">Period</dt><dd>{fmtDate(c.start_date)} → {c.end_date ? fmtDate(c.end_date) : "open"}</dd>
            {c.contract_type === "REVENUE_SHARE" && <><dt className="text-gray-500">Office share</dt><dd>{Number(c.revenue_share_pct)} %</dd></>}
            {c.contract_type === "RENTAL" && <><dt className="text-gray-500">Rental</dt><dd>{money(c.rental_amount_monthly)} / month</dd></>}
            <dt className="text-gray-500">Warranty until</dt><dd>{fmtDate(c.warranty_until)}</dd>
            <dt className="text-gray-500">AMC</dt><dd>{c.amc_until ? `${fmtDate(c.amc_until)} · ${money(c.amc_amount)}/yr` : "—"}</dd>
            <dt className="text-gray-500">Operator</dt><dd>{c.vendor_name || "—"}</dd>
          </dl>
          {c.penalty_rules && <pre className="mt-3 text-xs bg-gray-50 rounded-lg p-3 overflow-x-auto">{JSON.stringify(c.penalty_rules, null, 2)}</pre>}
        </Card>
        <Card title="Machines on this contract" bodyClass="p-0" actions={<button className="btn-secondary" onClick={() => setAttachOpen(true)}>+ Link machines</button>}>
          <Table head={["Machine", "Module", "Office", "Billing", ""]} empty="No machines linked yet">
            {machines.map((m) => (
              <tr key={m.machine_id}>
                <td className="table-td"><Link className="text-brand-600" to={`/admin/machines/${m.machine_id}`}>{m.name || m.machine_id}</Link><span className="block text-xs text-gray-400">{m.machine_id}</span></td>
                <td className="table-td"><ModuleBadge module={m.module} /></td>
                <td className="table-td text-xs">{m.organization_name || "—"}</td>
                <td className="table-td text-xs">{m.billing_mode === "DEPARTMENT" ? "Staff code (dept)" : "Citizen pays"}</td>
                <td className="table-td text-right"><button className="text-xs text-red-600" onClick={() => detach(m)}>Remove</button></td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <Card title="Invoices" bodyClass="p-0">
          <Table head={["Invoice", "Period", "Total", "Status", ""]} empty="No invoices yet">
            {invoices.map((i) => (
              <tr key={i.id}>
                <td className="table-td font-mono text-xs">{i.invoice_no}</td>
                <td className="table-td text-xs">{i.period_start ? `${fmtDate(i.period_start)} → ${fmtDate(i.period_end)}` : "—"}</td>
                <td className="table-td">{money(i.total)}</td>
                <td className="table-td"><Pill color={i.status === "PAID" ? "green" : i.status === "CANCELLED" ? "gray" : "amber"}>{i.status}</Pill></td>
                <td className="table-td text-right"><button className="text-xs text-brand-600" onClick={() => downloadFile(adminApi.invoicePdfPath(i.id), `${i.invoice_no}.pdf`)}>PDF</button></td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="Settlements (revenue share)" bodyClass="p-0">
          <Table head={["Period", "Gross", "Share", "Status"]} empty="No settlements">
            {settlements.map((s) => (
              <tr key={s.id}>
                <td className="table-td text-xs">{fmtDate(s.period_start)} → {fmtDate(s.period_end)}</td>
                <td className="table-td">{money(s.gross_revenue)}</td>
                <td className="table-td">{money(s.share_amount)} <span className="text-xs text-gray-400">({Number(s.share_pct)} %)</span></td>
                <td className="table-td"><Pill color={s.status === "PAID" ? "green" : s.status === "CANCELLED" ? "gray" : "amber"}>{s.status}</Pill></td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>

      <Card title="SLA by month" bodyClass="p-0">
        <Table head={["Month", "Machine", "Uptime", "Breached", "Penalty", ""]} empty="No SLA reports yet (they refresh daily, or use SLA → Recompute)">
          {sla.map((r) => (
            <tr key={`${r.machine_id}-${r.month}`}>
              <td className="table-td text-xs">{r.month}</td>
              <td className="table-td text-xs">{r.machine_id}</td>
              <td className="table-td">{Number(r.uptime_pct).toFixed(2)} %</td>
              <td className="table-td">{r.breached ? <Pill color="red">Yes</Pill> : <Pill color="green">No</Pill>}</td>
              <td className="table-td">{money(r.penalty_amount)}</td>
              <td className="table-td text-xs text-gray-400">{r.is_final ? "final" : "running"}</td>
            </tr>
          ))}
        </Table>
      </Card>

      <Modal open={editing} title={`Edit ${c.contract_no}`} onClose={() => setEditing(false)} wide>
        <ContractForm
          isEdit
          orgs={orgs.data}
          vendors={vendors.data}
          initial={{
            contractNo: c.contract_no, organizationId: c.organization_id, vendorId: c.vendor_id, contractType: c.contract_type,
            title: c.title || "", gemContractNo: c.gem_contract_no || "", poNumber: c.po_number || "", startDate: c.start_date,
            endDate: c.end_date || "", warrantyUntil: c.warranty_until || "", amcUntil: c.amc_until || "", amcAmount: c.amc_amount ?? "",
            rentalAmountMonthly: c.rental_amount_monthly ?? "", revenueSharePct: c.revenue_share_pct ?? "", slaUptimePct: c.sla_uptime_pct,
            billingCycle: c.billing_cycle, status: c.status, notes: c.notes || "",
            penaltyRules: c.penalty_rules ? JSON.stringify(c.penalty_rules, null, 2) : "",
          }}
          onSubmit={async (f) => { await adminApi.updateContract(c.id, f); setEditing(false); d.reload(); }}
        />
      </Modal>
      <AttachModal open={attachOpen} contract={c} machines={allMachines.data || []} onClose={(saved) => { setAttachOpen(false); if (saved) d.reload(); }} />
      {invOpen && <GenerateInvoiceModal contractId={c.id} contracts={[{ id: c.id, contract_no: c.contract_no, organization_name: c.organization_name, contract_type: c.contract_type }]}
        defaults={{ periodStart: monthStartYmd(-1), periodEnd: monthEndYmd(-1) }} onClose={(saved) => { setInvOpen(false); if (saved) d.reload(); }} />}
      {setlOpen && <GenerateSettlementModal contractId={c.id} contracts={[{ id: c.id, contract_no: c.contract_no, organization_name: c.organization_name, contract_type: c.contract_type }]}
        onClose={(saved) => { setSetlOpen(false); if (saved) d.reload(); }} />}
    </DashboardLayout>
  );
}

function AttachModal({ open, contract, machines, onClose }) {
  const [selected, setSelected] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const candidates = machines.filter((m) => m.contract_id !== contract.id);
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const submit = async () => {
    setBusy(true);
    setError("");
    try { await adminApi.attachMachines(contract.id, selected); setSelected([]); onClose(true); }
    catch (err) { setError(errMsg(err)); }
    finally { setBusy(false); }
  };
  return (
    <Modal open={open} title="Link machines to this contract" onClose={() => onClose(false)}>
      <p className="text-xs text-gray-500 mb-3">
        Machines without an organisation are placed under {contract.organization_name}.
        {contract.contract_type === "PAY_PER_USE" ? " Pay-per-use machines switch to staff-code billing (set the staff code on the machine page)." : ""}
      </p>
      <div className="max-h-80 overflow-y-auto divide-y divide-gray-100 border border-gray-100 rounded-lg">
        {candidates.length === 0 && <p className="p-4 text-sm text-gray-400">No other machines.</p>}
        {candidates.map((m) => (
          <label key={m.machine_id} className="flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-50">
            <input type="checkbox" checked={selected.includes(m.machine_id)} onChange={() => toggle(m.machine_id)} />
            <span className="text-sm">
              <span className="font-medium">{m.name || m.machine_id}</span> <span className="text-gray-400 text-xs">{m.machine_id}</span>
              <span className="block text-xs text-gray-400">{m.organization_name || "no organisation"}{m.contract_no ? ` · now on ${m.contract_no}` : ""}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="mt-3"><ErrorText>{error}</ErrorText></div>
      <button className="btn-primary mt-3" disabled={busy || !selected.length} onClick={submit}>{busy ? "Linking…" : `Link ${selected.length || ""} machine(s)`}</button>
    </Modal>
  );
}
