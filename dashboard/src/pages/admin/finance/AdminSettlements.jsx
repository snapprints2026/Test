// Settlements: the office's share of citizen payments on revenue-share contracts.
import React, { useState } from "react";
import { adminApi } from "../../../api/admin.api";
import { errMsg } from "../../../api/axiosClient";
import { useAuth } from "../../../context/AuthContext";
import DashboardLayout from "../../../components/DashboardLayout";
import { PageHeader, Card, Table, Modal, Field, ErrorText, Pill, money, fmtDate, fmtDateTime, monthStartYmd, monthEndYmd, useLoad } from "../../../components/ui";

const STATUS_COLOR = { PENDING: "amber", APPROVED: "blue", PAID: "green", CANCELLED: "gray" };

export default function AdminSettlements() {
  const { adminRole } = useAuth();
  const canEdit = ["SUPER_ADMIN", "ADMIN", "FINANCE"].includes(adminRole);
  const list = useLoad(() => adminApi.getSettlements(), []);
  const contracts = useLoad(() => adminApi.getContracts(), []);
  const [genOpen, setGenOpen] = useState(false);
  const [error, setError] = useState("");

  const update = async (s, status) => {
    let payload = { status };
    if (status === "PAID") {
      const ref = window.prompt(`Payment reference (UTR) for ${money(s.share_amount)} to ${s.organization_name}:`);
      if (!ref) return;
      payload.reference = ref;
    } else if (!window.confirm(`${status === "APPROVED" ? "Approve" : "Cancel"} this settlement?`)) return;
    try { await adminApi.updateSettlement(s.id, payload); list.reload(); } catch (err) { setError(errMsg(err)); }
  };

  return (
    <DashboardLayout>
      <PageHeader title="Settlements" sub="Revenue share owed to offices. Approved settlements are deducted from the operator's withdrawable balance.">
        {canEdit && <button className="btn-primary" onClick={() => setGenOpen(true)}>Generate settlement</button>}
      </PageHeader>
      <div className="mb-4"><ErrorText>{error}</ErrorText></div>
      <Card bodyClass="p-0">
        <Table head={["#", "Office", "Contract", "Period", "Citizen payments", "Share", "Status", "Reference", ""]} empty={list.loading ? "Loading…" : "No settlements yet"}>
          {(list.data || []).map((s) => (
            <tr key={s.id}>
              <td className="table-td text-xs text-gray-400">{s.id}</td>
              <td className="table-td text-sm">{s.organization_name}{s.vendor_name && <span className="block text-xs text-gray-400">operator: {s.vendor_name}</span>}</td>
              <td className="table-td font-mono text-xs">{s.contract_no}</td>
              <td className="table-td text-xs whitespace-nowrap">{fmtDate(s.period_start)} → {fmtDate(s.period_end)}</td>
              <td className="table-td">{money(s.gross_revenue)}</td>
              <td className="table-td font-semibold">{money(s.share_amount)} <span className="text-xs text-gray-400 font-normal">({Number(s.share_pct)} %)</span></td>
              <td className="table-td"><Pill color={STATUS_COLOR[s.status]}>{s.status}</Pill></td>
              <td className="table-td text-xs">{s.reference || "—"}{s.paid_at && <span className="block text-gray-400">{fmtDateTime(s.paid_at)}</span>}</td>
              <td className="table-td text-right whitespace-nowrap">
                {canEdit && s.status === "PENDING" && <button className="text-xs text-blue-700 mr-2" onClick={() => update(s, "APPROVED")}>Approve</button>}
                {canEdit && s.status === "APPROVED" && <button className="text-xs text-green-700 mr-2" onClick={() => update(s, "PAID")}>Mark paid</button>}
                {canEdit && ["PENDING", "APPROVED"].includes(s.status) && <button className="text-xs text-red-600" onClick={() => update(s, "CANCELLED")}>Cancel</button>}
              </td>
            </tr>
          ))}
        </Table>
      </Card>
      {genOpen && <GenerateSettlementModal contracts={(contracts.data || []).filter((c) => c.contract_type === "REVENUE_SHARE")} onClose={(saved) => { setGenOpen(false); if (saved) list.reload(); }} />}
    </DashboardLayout>
  );
}

export function GenerateSettlementModal({ contracts, contractId, onClose }) {
  const [f, setF] = useState({ contractId: contractId || "", periodStart: monthStartYmd(-1), periodEnd: monthEndYmd(-1) });
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => { setPreview(null); setF((x) => ({ ...x, [k]: e.target.value })); };
  const run = async (isPreview) => {
    setBusy(true); setError("");
    try {
      const r = await adminApi.generateSettlement({ ...f, contractId: Number(f.contractId), preview: isPreview });
      if (isPreview) setPreview(r); else onClose(true);
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <Modal open title="Generate settlement" onClose={() => onClose(false)}>
      <form onSubmit={(e) => { e.preventDefault(); run(true); }} className="space-y-3">
        <Field label="Revenue-share contract">
          <select className="input" required value={f.contractId} onChange={set("contractId")}>
            <option value="">Choose…</option>
            {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no} — {c.organization_name}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From"><input className="input" type="date" value={f.periodStart} onChange={set("periodStart")} /></Field>
          <Field label="To"><input className="input" type="date" value={f.periodEnd} onChange={set("periodEnd")} /></Field>
        </div>
        <ErrorText>{error}</ErrorText>
        <button className="btn-secondary" disabled={busy}>Preview</button>
      </form>
      {preview && (
        <div className="mt-4 border-t border-gray-100 pt-4 text-sm space-y-1">
          <p>{preview.orders} printed orders · citizen payments <b>{money(preview.grossRevenue)}</b></p>
          <p>Office share {preview.sharePct} % = <b className="text-lg">{money(preview.shareAmount)}</b></p>
          <button className="btn-primary mt-2" disabled={busy} onClick={() => run(false)}>Create settlement</button>
        </div>
      )}
    </Modal>
  );
}
