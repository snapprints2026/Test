// Form catalogue: blank government forms citizens print without uploading.
// Upload the official PDF from the issuing department (e.g. parivahan.gov.in).
import React, { useState } from "react";
import { adminApi } from "../../../api/admin.api";
import { errMsg } from "../../../api/axiosClient";
import DashboardLayout from "../../../components/DashboardLayout";
import { PageHeader, Card, Table, Modal, Field, ErrorText, Pill, OrgSelect, SEGMENTS, useLoad } from "../../../components/ui";

const EMPTY = { code: "", title: "", titleHi: "", titleMr: "", description: "", category: "", segment: "GOVERNMENT", organizationId: null, defaultCopies: 1, color: "bw", paperSize: "A4", printSide: "single", sourceUrl: "", sortOrder: 0 };

export default function AdminForms() {
  const forms = useLoad(() => adminApi.getForms(), []);
  const orgs = useLoad(() => adminApi.getOrganizations(), []);
  const [editing, setEditing] = useState(null); // form row or "new"
  const [error, setError] = useState("");
  const [uploadingId, setUploadingId] = useState(null);

  const upload = async (form, file) => {
    if (!file) return;
    setError("");
    setUploadingId(form.id);
    try {
      const { uploadUrl, key, contentType } = await adminApi.formUploadUrl(form.id);
      const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": contentType }, body: file });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      await adminApi.completeFormUpload(form.id, key);
      forms.reload();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setUploadingId(null);
    }
  };
  const toggle = async (f) => {
    try { await adminApi.updateForm(f.id, { isActive: !f.is_active }); forms.reload(); } catch (err) { setError(errMsg(err)); }
  };
  const preview = async (f) => {
    try { const { url } = await adminApi.previewForm(f.id); window.open(url, "_blank", "noopener"); } catch (err) { setError(errMsg(err)); }
  };

  return (
    <DashboardLayout>
      <PageHeader title="Form catalogue" sub="Citizens tap a form, pay and print — no upload. Machines need FORM switched on (Machines → View).">
        <button className="btn-primary" onClick={() => setEditing("new")}>+ Add form</button>
      </PageHeader>
      <div className="mb-4"><ErrorText>{error}</ErrorText></div>
      <Card bodyClass="p-0">
        <Table head={["Code", "Title", "Category", "Available to", "PDF", "Printed", "Status", ""]} empty={forms.loading ? "Loading…" : "No forms yet"}>
          {(forms.data || []).map((f) => (
            <tr key={f.id}>
              <td className="table-td font-mono text-xs">{f.code}</td>
              <td className="table-td text-sm">
                <span className="font-medium">{f.title}</span>
                {(f.title_hi || f.title_mr) && <span className="block text-xs text-gray-400">{[f.title_hi, f.title_mr].filter(Boolean).join(" · ")}</span>}
              </td>
              <td className="table-td text-xs">{f.category || "—"}</td>
              <td className="table-td text-xs">{f.organization_name ? `${f.organization_name} (+ below)` : f.segment ? `All ${SEGMENTS[f.segment]?.label} machines` : "All machines"}</td>
              <td className="table-td text-xs whitespace-nowrap">
                {f.has_file ? <button className="text-brand-600" onClick={() => preview(f)}>{f.page_count} page(s) ↗</button> : <span className="text-amber-600">not uploaded</span>}
                <label className="block text-brand-600 cursor-pointer mt-1">
                  {uploadingId === f.id ? "Uploading…" : f.has_file ? "Replace PDF" : "Upload PDF"}
                  <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => upload(f, e.target.files[0])} />
                </label>
              </td>
              <td className="table-td">{f.times_printed}</td>
              <td className="table-td"><Pill color={f.is_active ? "green" : "gray"}>{f.is_active ? "ACTIVE" : "HIDDEN"}</Pill></td>
              <td className="table-td text-right whitespace-nowrap">
                <button className="text-xs text-brand-600 mr-2" onClick={() => setEditing(f)}>Edit</button>
                <button className="text-xs text-gray-600" disabled={!f.has_file} onClick={() => toggle(f)}>{f.is_active ? "Hide" : "Activate"}</button>
              </td>
            </tr>
          ))}
        </Table>
      </Card>
      {editing && (
        <FormModal
          form={editing === "new" ? null : editing}
          orgs={orgs.data}
          onClose={(saved) => { setEditing(null); if (saved) forms.reload(); }}
        />
      )}
    </DashboardLayout>
  );
}

function FormModal({ form, orgs, onClose }) {
  const [f, setF] = useState(form ? {
    code: form.code, title: form.title, titleHi: form.title_hi || "", titleMr: form.title_mr || "", description: form.description || "",
    category: form.category || "", segment: form.segment || "", organizationId: form.organization_id, defaultCopies: form.default_copies,
    color: form.color, paperSize: form.paper_size, printSide: form.print_side, sourceUrl: form.source_url || "", sortOrder: form.sort_order,
  } : EMPTY);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const payload = { ...f, segment: f.segment || null };
      if (form) await adminApi.updateForm(form.id, payload); else await adminApi.createForm(payload);
      onClose(true);
    } catch (err) { setError(errMsg(err)); setBusy(false); }
  };
  return (
    <Modal open title={form ? `Edit ${form.code}` : "Add form"} onClose={() => onClose(false)} wide>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Code"><input className="input font-mono" required value={f.code} onChange={set("code")} placeholder="RTO-FORM-1" /></Field>
          <Field label="Category"><input className="input" value={f.category} onChange={set("category")} placeholder="Driving licence" /></Field>
          <Field label="Sort order"><input className="input" type="number" value={f.sortOrder} onChange={set("sortOrder")} /></Field>
        </div>
        <Field label="Title (English)"><input className="input" required value={f.title} onChange={set("title")} /></Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Title (हिन्दी)"><input className="input" value={f.titleHi} onChange={set("titleHi")} /></Field>
          <Field label="Title (मराठी)"><input className="input" value={f.titleMr} onChange={set("titleMr")} /></Field>
        </div>
        <Field label="Description"><input className="input" value={f.description} onChange={set("description")} /></Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Available to segment" hint="Used when no organisation is chosen">
            <select className="input" value={f.segment || ""} onChange={set("segment")}>
              <option value="">Every machine</option>
              {Object.entries(SEGMENTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </Field>
          <Field label="Only this organisation (and below)">
            <OrgSelect orgs={orgs} value={f.organizationId} onChange={(v) => setF((x) => ({ ...x, organizationId: v }))} placeholder="— any —" />
          </Field>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label="Default copies"><input className="input" type="number" min="1" max="20" value={f.defaultCopies} onChange={set("defaultCopies")} /></Field>
          <Field label="Colour"><select className="input" value={f.color} onChange={set("color")}><option value="bw">B&W</option><option value="color">Colour</option></select></Field>
          <Field label="Paper"><select className="input" value={f.paperSize} onChange={set("paperSize")}><option>A4</option><option>A3</option></select></Field>
          <Field label="Sides"><select className="input" value={f.printSide} onChange={set("printSide")}><option value="single">Single</option><option value="duplex">Double-sided</option></select></Field>
        </div>
        <Field label="Official source URL" hint="Shown to citizens as 'Official source'"><input className="input" value={f.sourceUrl} onChange={set("sourceUrl")} placeholder="https://parivahan.gov.in/…" /></Field>
        <ErrorText>{error}</ErrorText>
        <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : form ? "Save" : "Create (then upload the PDF)"}</button>
      </form>
    </Modal>
  );
}
