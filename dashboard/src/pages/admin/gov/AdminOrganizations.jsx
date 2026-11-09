// Organisations: the customer institution as a tree
// (State Transport Dept → RTO Panvel (MH-46) → Counter 1). Reports roll up.
import React, { useState } from "react";
import { Link } from "react-router-dom";
import { adminApi } from "../../../api/admin.api";
import { errMsg } from "../../../api/axiosClient";
import DashboardLayout from "../../../components/DashboardLayout";
import { PageHeader, Card, Table, Modal, Field, ErrorText, Pill, SegmentBadge, OrgSelect, SEGMENTS, useLoad } from "../../../components/ui";

const ORG_TYPES = { DEPARTMENT: "Department", OFFICE: "Office", COUNTER: "Counter", CAMPUS: "Campus", COMPANY: "Company", OTHER: "Other" };
const EMPTY = { name: "", parentId: null, orgType: "OFFICE", segment: "GOVERNMENT", officeCode: "", gstin: "", address: "", city: "", state: "", pincode: "", contactName: "", contactEmail: "", contactPhone: "", defaultLanguage: "", vendorId: null };

export function OrgForm({ initial = EMPTY, orgs, vendors, onSubmit, submitLabel = "Save", excludeId }) {
  const [form, setForm] = useState({ ...EMPTY, ...initial });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSubmit({ ...form, defaultLanguage: form.defaultLanguage || null });
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Name"><input className="input" required value={form.name} onChange={set("name")} placeholder="RTO Panvel" /></Field>
        <Field label="Belongs to (parent)">
          <OrgSelect orgs={orgs} value={form.parentId} exclude={excludeId} onChange={(v) => setForm((f) => ({ ...f, parentId: v }))} placeholder="— top level —" />
        </Field>
        <Field label="Type">
          <select className="input" value={form.orgType} onChange={set("orgType")}>
            {Object.entries(ORG_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Segment">
          <select className="input" value={form.segment} onChange={set("segment")}>
            {Object.entries(SEGMENTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </Field>
        <Field label="Office code" hint="e.g. RTO code MH-46"><input className="input" value={form.officeCode || ""} onChange={set("officeCode")} /></Field>
        <Field label="GSTIN (for invoices)"><input className="input" value={form.gstin || ""} onChange={set("gstin")} /></Field>
      </div>
      <Field label="Address"><input className="input" value={form.address || ""} onChange={set("address")} /></Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="City"><input className="input" value={form.city || ""} onChange={set("city")} /></Field>
        <Field label="State" hint="Decides CGST+SGST or IGST"><input className="input" value={form.state || ""} onChange={set("state")} /></Field>
        <Field label="Pincode"><input className="input" value={form.pincode || ""} onChange={set("pincode")} /></Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Contact name"><input className="input" value={form.contactName || ""} onChange={set("contactName")} /></Field>
        <Field label="Contact email"><input className="input" type="email" value={form.contactEmail || ""} onChange={set("contactEmail")} /></Field>
        <Field label="Contact phone"><input className="input" value={form.contactPhone || ""} onChange={set("contactPhone")} /></Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Print page language" hint="Machines here start in this language">
          <select className="input" value={form.defaultLanguage || ""} onChange={set("defaultLanguage")}>
            <option value="">Customer's phone language</option>
            <option value="en">English</option><option value="hi">हिन्दी (Hindi)</option><option value="mr">मराठी (Marathi)</option>
          </select>
        </Field>
        <Field label="Operator (vendor)">
          <select className="input" value={form.vendorId || ""} onChange={(e) => setForm((f) => ({ ...f, vendorId: e.target.value ? Number(e.target.value) : null }))}>
            <option value="">— none —</option>
            {(vendors || []).map((v) => <option key={v.id} value={v.id}>{v.full_name}{v.business_name ? ` — ${v.business_name}` : ""}</option>)}
          </select>
        </Field>
      </div>
      <ErrorText>{error}</ErrorText>
      <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : submitLabel}</button>
    </form>
  );
}

export default function AdminOrganizations() {
  const orgs = useLoad(() => adminApi.getOrganizations(), []);
  const vendors = useLoad(() => adminApi.getVendors(), []);
  const [creating, setCreating] = useState(false);

  return (
    <DashboardLayout>
      <PageHeader title="Organisations" sub="Departments, offices and counters you serve. Officers and reports follow this tree.">
        <button className="btn-primary" onClick={() => setCreating(true)}>+ Add organisation</button>
      </PageHeader>
      <Card bodyClass="p-0">
        <Table head={["Organisation", "Type", "Segment", "Office code", "Machines", "Officers", "Status", ""]} empty={orgs.loading ? "Loading…" : "No organisations yet"}>
          {(orgs.data || []).map((o) => (
            <tr key={o.id}>
              <td className="table-td">
                <span style={{ paddingLeft: `${o.depth * 18}px` }} className="font-medium">
                  {o.depth > 0 && <span className="text-gray-300 mr-1">└</span>}{o.name}
                </span>
                {o.city && <span className="block text-xs text-gray-400" style={{ paddingLeft: `${o.depth * 18}px` }}>{o.city}{o.state ? `, ${o.state}` : ""}</span>}
              </td>
              <td className="table-td text-xs text-gray-500">{ORG_TYPES[o.org_type]}</td>
              <td className="table-td"><SegmentBadge segment={o.segment} /></td>
              <td className="table-td font-mono text-xs">{o.office_code || "—"}</td>
              <td className="table-td">{o.machine_count}</td>
              <td className="table-td">{o.officer_count}</td>
              <td className="table-td"><Pill color={o.status === "ACTIVE" ? "green" : "gray"}>{o.status}</Pill></td>
              <td className="table-td text-right"><Link className="text-brand-600 hover:text-brand-700 text-sm font-medium" to={`/admin/organizations/${o.id}`}>View →</Link></td>
            </tr>
          ))}
        </Table>
      </Card>
      <Modal open={creating} title="Add organisation" onClose={() => setCreating(false)} wide>
        <OrgForm
          orgs={orgs.data}
          vendors={vendors.data}
          submitLabel="Create organisation"
          onSubmit={async (f) => { await adminApi.createOrganization(f); setCreating(false); orgs.reload(); }}
        />
      </Modal>
    </DashboardLayout>
  );
}
