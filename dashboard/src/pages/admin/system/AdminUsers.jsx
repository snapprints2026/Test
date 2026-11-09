// Admin users and roles (SUPER_ADMIN only).
import React, { useState } from "react";
import { adminApi } from "../../../api/admin.api";
import { errMsg } from "../../../api/axiosClient";
import DashboardLayout from "../../../components/DashboardLayout";
import { PageHeader, Card, Table, Modal, Field, ErrorText, Pill, fmtDateTime, useLoad } from "../../../components/ui";

const ROLES = {
  SUPER_ADMIN: "Everything, including admin users",
  ADMIN: "Everything except admin users",
  FINANCE: "Read all + invoices, settlements, withdrawals, pricing",
  SUPPORT: "Read all + tickets, refunds, machine settings",
};

export default function AdminUsers() {
  const users = useLoad(() => adminApi.getAdminUsers(), []);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const update = async (u, payload) => {
    setError("");
    try { await adminApi.updateAdminUser(u.id, payload); users.reload(); } catch (err) { setError(errMsg(err)); }
  };
  const resetPw = (u) => {
    const pw = window.prompt(`New password for ${u.email} (at least 8 characters):`);
    if (pw) update(u, { password: pw });
  };
  return (
    <DashboardLayout>
      <PageHeader title="Admin users" sub="SnapPrints staff logins and what each role may change.">
        <button className="btn-primary" onClick={() => setOpen(true)}>+ Add admin</button>
      </PageHeader>
      <div className="mb-4"><ErrorText>{error}</ErrorText></div>
      <Card bodyClass="p-0">
        <Table head={["Name", "Email", "Role", "Last login", "Status", ""]}>
          {(users.data || []).map((u) => (
            <tr key={u.id}>
              <td className="table-td font-medium">{u.name}</td>
              <td className="table-td text-gray-500">{u.email}</td>
              <td className="table-td">
                <select className="input py-1 text-xs" value={u.role} onChange={(e) => update(u, { role: e.target.value })}>
                  {Object.keys(ROLES).map((r) => <option key={r}>{r}</option>)}
                </select>
              </td>
              <td className="table-td text-xs text-gray-500">{fmtDateTime(u.last_login_at)}</td>
              <td className="table-td"><Pill color={u.status === "ACTIVE" ? "green" : "gray"}>{u.status}</Pill></td>
              <td className="table-td text-right whitespace-nowrap">
                <button className="text-xs text-brand-600 mr-3" onClick={() => resetPw(u)}>Reset password</button>
                <button className="text-xs text-gray-600" onClick={() => update(u, { status: u.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" })}>{u.status === "ACTIVE" ? "Disable" : "Enable"}</button>
              </td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card title="Roles" className="mt-6">
        <ul className="text-sm space-y-1">{Object.entries(ROLES).map(([k, v]) => <li key={k}><b className="font-mono text-xs">{k}</b> — {v}</li>)}</ul>
      </Card>
      {open && <NewAdmin onClose={(saved) => { setOpen(false); if (saved) users.reload(); }} />}
    </DashboardLayout>
  );
}

function NewAdmin({ onClose }) {
  const [f, setF] = useState({ name: "", email: "", password: "", role: "SUPPORT" });
  const [error, setError] = useState("");
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    try { await adminApi.createAdminUser(f); onClose(true); } catch (err) { setError(errMsg(err)); }
  };
  return (
    <Modal open title="Add admin user" onClose={() => onClose(false)}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Name"><input className="input" required value={f.name} onChange={set("name")} /></Field>
        <Field label="Email"><input className="input" type="email" required value={f.email} onChange={set("email")} /></Field>
        <Field label="Role"><select className="input" value={f.role} onChange={set("role")}>{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}</select></Field>
        <Field label="Initial password"><input className="input" required minLength={8} value={f.password} onChange={set("password")} /></Field>
        <ErrorText>{error}</ErrorText>
        <button className="btn-primary">Create</button>
      </form>
    </Modal>
  );
}
