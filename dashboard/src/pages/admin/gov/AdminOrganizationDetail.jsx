// One organisation: details, offices below it, machines, contracts and officer logins.
import React, { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { adminApi } from "../../../api/admin.api";
import { errMsg } from "../../../api/axiosClient";
import DashboardLayout from "../../../components/DashboardLayout";
import ModuleBadge from "../../../components/ModuleBadge";
import { PageHeader, Card, Table, Modal, Field, ErrorText, Pill, SegmentBadge, Stat, money, fmtDate, fmtDateTime, CONTRACT_TYPES, useLoad } from "../../../components/ui";
import { OrgForm } from "./AdminOrganizations";

export default function AdminOrganizationDetail() {
  const { orgId } = useParams();
  const navigate = useNavigate();
  const d = useLoad(() => adminApi.getOrganization(orgId), [orgId]);
  const orgs = useLoad(() => adminApi.getOrganizations(), []);
  const vendors = useLoad(() => adminApi.getVendors(), []);
  const [editing, setEditing] = useState(false);
  const [officerOpen, setOfficerOpen] = useState(false);
  const [error, setError] = useState("");

  if (!d.data) return <DashboardLayout><p className="text-sm text-gray-400">{d.error || "Loading…"}</p></DashboardLayout>;
  const { organization: o, path, children, machines, contracts, officers, usage30d } = d.data;

  const toggleOfficer = async (f) => {
    try { await adminApi.updateOfficer(f.id, { status: f.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" }); d.reload(); }
    catch (err) { setError(errMsg(err)); }
  };
  const resetPassword = async (f) => {
    const pw = window.prompt(`New password for ${f.name} (at least 8 characters):`);
    if (!pw) return;
    try { await adminApi.updateOfficer(f.id, { password: pw }); alert("Password changed. Share it with the officer securely."); }
    catch (err) { setError(errMsg(err)); }
  };
  const remove = async () => {
    if (!window.confirm(`Delete ${o.name}?`)) return;
    try { await adminApi.deleteOrganization(o.id); navigate("/admin/organizations"); }
    catch (err) { setError(errMsg(err)); }
  };

  return (
    <DashboardLayout>
      <Link to="/admin/organizations" className="text-sm text-gray-500 hover:text-gray-700">← Organisations</Link>
      <PageHeader title={o.name} sub={path}>
        <SegmentBadge segment={o.segment} />
        <Pill color={o.status === "ACTIVE" ? "green" : "gray"}>{o.status}</Pill>
        <button className="btn-secondary" onClick={() => setEditing(true)}>Edit</button>
        <button className="btn-secondary text-red-600" onClick={remove}>Delete</button>
      </PageHeader>
      <ErrorText>{error}</ErrorText>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Stat label="Orders (30 days)" value={usage30d.orders} />
        <Stat label="Pages (30 days)" value={Number(usage30d.pages).toLocaleString("en-IN")} />
        <Stat label="Citizen payments (30 days)" value={money(usage30d.customer_revenue)} tone="text-green-700" />
        <Stat label="Billed to department (30 days)" value={money(usage30d.department_billed)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <Card title="Details">
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-gray-500">Type</dt><dd>{o.org_type}</dd>
            <dt className="text-gray-500">Office code</dt><dd className="font-mono">{o.office_code || "—"}</dd>
            <dt className="text-gray-500">GSTIN</dt><dd>{o.gstin || "—"}</dd>
            <dt className="text-gray-500">Address</dt><dd>{[o.address, o.city, o.state, o.pincode].filter(Boolean).join(", ") || "—"}</dd>
            <dt className="text-gray-500">Contact</dt><dd>{[o.contact_name, o.contact_phone, o.contact_email].filter(Boolean).join(" · ") || "—"}</dd>
            <dt className="text-gray-500">Language</dt><dd>{{ en: "English", hi: "Hindi", mr: "Marathi" }[o.default_language] || "Phone default"}</dd>
            <dt className="text-gray-500">Operator</dt><dd>{o.vendor_name || "—"}</dd>
          </dl>
        </Card>
        <Card title="Offices below" bodyClass="p-0">
          <Table head={["Name", "Type", "Code"]} empty="No offices below this one">
            {children.map((c) => (
              <tr key={c.id}>
                <td className="table-td"><Link className="text-brand-600" to={`/admin/organizations/${c.id}`}>{c.name}</Link></td>
                <td className="table-td text-xs">{c.org_type}</td>
                <td className="table-td font-mono text-xs">{c.office_code || "—"}</td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>

      <Card title="Officer logins (read-only)" className="mb-6" bodyClass="p-0" actions={<button className="btn-primary" onClick={() => setOfficerOpen(true)}>+ Add officer</button>}>
        <Table head={["Name", "Email", "Designation", "Office", "Last login", "Status", ""]} empty="No officers yet">
          {officers.map((f) => (
            <tr key={f.id}>
              <td className="table-td font-medium">{f.name}</td>
              <td className="table-td text-gray-500">{f.email}</td>
              <td className="table-td text-xs">{f.designation || "—"}</td>
              <td className="table-td text-xs">{f.organization_name}</td>
              <td className="table-td text-xs text-gray-500">{fmtDateTime(f.last_login_at)}</td>
              <td className="table-td"><Pill color={f.status === "ACTIVE" ? "green" : "gray"}>{f.status}</Pill></td>
              <td className="table-td text-right whitespace-nowrap">
                <button className="text-xs text-brand-600 mr-3" onClick={() => resetPassword(f)}>Reset password</button>
                <button className="text-xs text-gray-600" onClick={() => toggleOfficer(f)}>{f.status === "ACTIVE" ? "Disable" : "Enable"}</button>
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Machines (here and below)" bodyClass="p-0">
          <Table head={["Machine", "Module", "Office", "Contract", "Status"]} empty="No machines yet — link them from Machines → View">
            {machines.map((m) => (
              <tr key={m.machine_id}>
                <td className="table-td"><Link className="text-brand-600" to={`/admin/machines/${m.machine_id}`}>{m.name || m.machine_id}</Link><span className="block text-xs text-gray-400">{m.machine_id}</span></td>
                <td className="table-td"><ModuleBadge module={m.module} /></td>
                <td className="table-td text-xs">{m.organization_name}</td>
                <td className="table-td text-xs font-mono">{m.contract_no || "—"}</td>
                <td className="table-td"><Pill color={m.status === "PENDING" ? "amber" : m.is_online ? "green" : "gray"}>{m.status === "PENDING" ? "PENDING" : m.is_online ? "ONLINE" : "OFFLINE"}</Pill></td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="Contracts" bodyClass="p-0" actions={<Link className="btn-secondary" to={`/admin/contracts?org=${o.id}`}>+ New contract</Link>}>
          <Table head={["Contract", "Type", "From", "To", "Status"]} empty="No contracts yet">
            {contracts.map((c) => (
              <tr key={c.id}>
                <td className="table-td"><Link className="text-brand-600 font-mono text-xs" to={`/admin/contracts/${c.id}`}>{c.contract_no}</Link><span className="block text-xs text-gray-400">{c.title || c.organization_name}</span></td>
                <td className="table-td text-xs">{CONTRACT_TYPES[c.contract_type]}</td>
                <td className="table-td text-xs">{fmtDate(c.start_date)}</td>
                <td className="table-td text-xs">{fmtDate(c.end_date)}</td>
                <td className="table-td"><Pill color={c.status === "ACTIVE" ? "green" : "gray"}>{c.status}</Pill></td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>

      <Modal open={editing} title={`Edit ${o.name}`} onClose={() => setEditing(false)} wide>
        <OrgForm
          orgs={orgs.data}
          vendors={vendors.data}
          excludeId={o.id}
          initial={{
            name: o.name, parentId: o.parent_id, orgType: o.org_type, segment: o.segment, officeCode: o.office_code, gstin: o.gstin,
            address: o.address, city: o.city, state: o.state, pincode: o.pincode, contactName: o.contact_name,
            contactEmail: o.contact_email, contactPhone: o.contact_phone, defaultLanguage: o.default_language || "", vendorId: o.vendor_id,
          }}
          onSubmit={async (f) => { await adminApi.updateOrganization(o.id, f); setEditing(false); d.reload(); orgs.reload(); }}
        />
      </Modal>
      <OfficerModal open={officerOpen} orgs={orgs.data} defaultOrg={o.id} onClose={(saved) => { setOfficerOpen(false); if (saved) d.reload(); }} />
    </DashboardLayout>
  );
}

function OfficerModal({ open, orgs, defaultOrg, onClose }) {
  const [form, setForm] = useState({ name: "", email: "", password: "", phone: "", designation: "", organizationId: defaultOrg });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try { await adminApi.createOfficer({ ...form, organizationId: form.organizationId || defaultOrg }); onClose(true); setForm((f) => ({ ...f, name: "", email: "", password: "" })); }
    catch (err) { setError(errMsg(err)); }
    finally { setBusy(false); }
  };
  return (
    <Modal open={open} title="Add officer login" onClose={() => onClose(false)}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-xs text-gray-500">The officer sees usage, money totals, invoices, uptime and complaints for the chosen office and every office below it — never citizens' phone numbers or documents.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name"><input className="input" required value={form.name} onChange={set("name")} /></Field>
          <Field label="Designation"><input className="input" value={form.designation} onChange={set("designation")} placeholder="Deputy RTO" /></Field>
          <Field label="Email (login)"><input className="input" type="email" required value={form.email} onChange={set("email")} /></Field>
          <Field label="Phone"><input className="input" value={form.phone} onChange={set("phone")} /></Field>
        </div>
        <Field label="Office (scope)">
          <select className="input" value={form.organizationId || ""} onChange={(e) => setForm((f) => ({ ...f, organizationId: Number(e.target.value) }))}>
            {(orgs || []).map((o) => <option key={o.id} value={o.id}>{`${"  ".repeat(o.depth)}${o.name}`}</option>)}
          </select>
        </Field>
        <Field label="Initial password" hint="At least 8 characters. Share it securely."><input className="input" required minLength={8} value={form.password} onChange={set("password")} /></Field>
        <ErrorText>{error}</ErrorText>
        <button className="btn-primary" disabled={busy}>{busy ? "Creating…" : "Create officer"}</button>
      </form>
    </Modal>
  );
}
