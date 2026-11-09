import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { adminApi } from "../../api/admin.api";
import DashboardLayout from "../../components/DashboardLayout";
import Loader from "../../components/Loader";
import ModuleBadge from "../../components/ModuleBadge";
import { SegmentBadge, SEGMENTS } from "../../components/ui";

const INSTITUTION_TYPES = [
  ["COLLEGE", "College"],
  ["UNIVERSITY", "University"],
  ["SCHOOL", "School"],
  ["COACHING", "Coaching institute"],
  ["SHOP", "Shop / business"],
  ["GOVERNMENT_OFFICE", "Government office (RTO, tehsil…)"],
  ["BANK", "Bank branch"],
  ["PSU_OFFICE", "PSU office"],
  ["OTHER", "Other"],
];
// The customer segment follows from the type unless the admin picks one.
const SEGMENT_FOR_TYPE = { SHOP: "RETAIL", GOVERNMENT_OFFICE: "GOVERNMENT", BANK: "PSU", PSU_OFFICE: "PSU" };
const TYPE_LABEL = Object.fromEntries(INSTITUTION_TYPES);

const MODULE_OPTIONS = [
  ["KIOSK", "Kiosk (Raspberry Pi)"],
  ["SHOP", "Shop computer"],
];

const EMPTY_FORM = {
  // institution
  businessName: "",
  institutionType: "COLLEGE",
  billingAddress: "",
  gstNumber: "",
  panNumber: "",
  allowedModules: ["KIOSK"],
  segment: "EDUCATION",
  // contact person + login
  fullName: "",
  contactDesignation: "",
  email: "",
  phone: "",
  altPhone: "",
  password: "",
};

const vendorLabel = (v) => v.business_name || v.full_name;

function generatePassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint32Array(10);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => chars[n % chars.length]).join("");
}

function Field({ label, required, hint, className = "", children }) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">{title}</h3>
      {children}
    </div>
  );
}

export default function AdminVendors() {
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(null); // { email, password } to hand over
  const [search, setSearch] = useState("");
  const [segmentFilter, setSegmentFilter] = useState("");

  const load = () => {
    setLoading(true);
    adminApi.getVendors().then(setVendors).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const filteredVendors = useMemo(() => {
    const q = search.trim().toLowerCase();
    const bySegment = segmentFilter ? vendors.filter((v) => v.segment === segmentFilter) : vendors;
    if (!q) return bySegment;
    return bySegment.filter((v) =>
      [v.business_name, v.full_name, v.email, v.phone, v.alt_phone, v.gst_number, TYPE_LABEL[v.institution_type]]
        .filter(Boolean)
        .some((x) => String(x).toLowerCase().includes(q))
    );
  }, [vendors, search, segmentFilter]);

  const handleChange = (field) => (e) =>
    setForm((f) => {
      const next = { ...f, [field]: e.target.value };
      if (field === "institutionType") next.segment = SEGMENT_FOR_TYPE[e.target.value] || "EDUCATION";
      return next;
    });
  const handleUpper = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value.toUpperCase() }));

  const toggleModule = (code) =>
    setForm((f) => ({
      ...f,
      allowedModules: f.allowedModules.includes(code)
        ? f.allowedModules.filter((m) => m !== code)
        : [...f.allowedModules, code],
    }));

  const handleCreate = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.allowedModules.length) {
      setError("Pick at least one module the vendor has bought");
      return;
    }
    setCreating(true);
    try {
      await adminApi.createVendor({ ...form, allowedModules: form.allowedModules.join(",") });
      setCreated({ email: form.email.trim().toLowerCase(), password: form.password });
      setForm(EMPTY_FORM);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to create vendor");
    } finally {
      setCreating(false);
    }
  };

  const isCollegeLike = ["COLLEGE", "UNIVERSITY", "SCHOOL", "COACHING"].includes(form.institutionType);

  return (
    <DashboardLayout>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-xl font-semibold text-gray-800">Vendors</h1>
        <div className="flex items-center gap-2">
        <select className="input py-1.5 text-sm" style={{ width: "auto" }} value={segmentFilter} onChange={(e) => setSegmentFilter(e.target.value)}>
          <option value="">All segments</option>
          {Object.entries(SEGMENTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <button
          className="btn-primary"
          onClick={() => {
            setShowForm((s) => !s);
            setError("");
          }}
        >
          {showForm ? "Cancel" : "+ Create Vendor"}
        </button>
        </div>
      </div>

      {showForm && (
        <div className="card p-6 mb-6 max-w-3xl">
          <form onSubmit={handleCreate} className="space-y-6">
            <Section title="Institution">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label={isCollegeLike ? "Institution name" : "Business name"} required className="sm:col-span-2">
                  <input
                    required
                    className="input"
                    value={form.businessName}
                    onChange={handleChange("businessName")}
                    placeholder={isCollegeLike ? "ABC College of Engineering" : "Sai Xerox Centre"}
                  />
                </Field>
                <Field label="Type" required>
                  <select className="input" value={form.institutionType} onChange={handleChange("institutionType")}>
                    {INSTITUTION_TYPES.map(([code, label]) => (
                      <option key={code} value={code}>{label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Modules bought" required>
                  <div className="flex flex-wrap gap-2">
                    {MODULE_OPTIONS.map(([code, label]) => {
                      const on = form.allowedModules.includes(code);
                      return (
                        <button
                          key={code}
                          type="button"
                          onClick={() => toggleModule(code)}
                          className={`px-3 py-1.5 rounded-full text-xs font-medium border ${
                            on ? "bg-gray-800 text-white border-gray-800" : "bg-white text-gray-600 border-gray-300"
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </Field>
                <Field label="Customer segment" required hint="Decides the default services and privacy. Education, Government and PSU keep no file names; Retail is standard." className="sm:col-span-2">
                  <select className="input" value={form.segment} onChange={(e) => setForm((f) => ({ ...f, segment: e.target.value }))}>
                    {Object.entries(SEGMENTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </Field>
                <Field label="Billing address" hint="Used on invoices. Machine locations are added per machine." className="sm:col-span-2">
                  <textarea
                    rows={2}
                    className="input"
                    value={form.billingAddress}
                    onChange={handleChange("billingAddress")}
                  />
                </Field>
                <Field label="GST number" hint="Leave empty if the institution isn't GST-registered.">
                  <input
                    className="input"
                    maxLength={15}
                    value={form.gstNumber}
                    onChange={handleUpper("gstNumber")}
                    placeholder="27ABCDE1234F1Z5"
                  />
                </Field>
                <Field label="PAN" hint="Needed for payouts.">
                  <input
                    className="input"
                    maxLength={10}
                    value={form.panNumber}
                    onChange={handleUpper("panNumber")}
                    placeholder="ABCDE1234F"
                  />
                </Field>
              </div>
            </Section>

            <Section title="Contact person & login">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Contact person" required>
                  <input required className="input" value={form.fullName} onChange={handleChange("fullName")} placeholder="Prof. R. Sharma" />
                </Field>
                <Field label="Designation">
                  <input
                    className="input"
                    value={form.contactDesignation}
                    onChange={handleChange("contactDesignation")}
                    placeholder="Admin Officer / Librarian"
                  />
                </Field>
                <Field label="Phone">
                  <input className="input" type="tel" inputMode="tel" value={form.phone} onChange={handleChange("phone")} />
                </Field>
                <Field label="Alternate phone" hint="College landlines are often unanswered.">
                  <input className="input" type="tel" inputMode="tel" value={form.altPhone} onChange={handleChange("altPhone")} />
                </Field>
                <Field label="Login email" required>
                  <input required type="email" className="input" value={form.email} onChange={handleChange("email")} />
                </Field>
                <Field label="Initial password" required>
                  <div className="flex gap-2">
                    <input required className="input" value={form.password} onChange={handleChange("password")} />
                    <button
                      type="button"
                      className="text-xs font-medium text-brand-600 hover:text-brand-700 whitespace-nowrap"
                      onClick={() => setForm((f) => ({ ...f, password: generatePassword() }))}
                    >
                      Generate
                    </button>
                  </div>
                </Field>
              </div>
            </Section>

            {error && <p className="text-sm text-red-600">{error}</p>}
            <button type="submit" disabled={creating} className="btn-primary">
              {creating ? "Creating..." : "Create vendor"}
            </button>
            <p className="text-xs text-gray-400">
              Share the email + password with the vendor so they can log in — there's no self-signup.
            </p>
          </form>
        </div>
      )}

      {created && (
        <div className="card p-5 mb-6 bg-amber-50 border-amber-200 max-w-xl">
          <p className="text-sm font-semibold text-amber-800 mb-2">Vendor created — share these login details:</p>
          <pre className="text-xs bg-white p-3 rounded-lg overflow-x-auto">
{`Email:    ${created.email}
Password: ${created.password}`}
          </pre>
          <button className="text-xs text-amber-700 mt-2 underline" onClick={() => setCreated(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="mb-4 max-w-md">
        <input
          className="input"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by institution, contact, email, phone or GST"
        />
      </div>

      {loading ? (
        <Loader />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="table-th">Institution</th>
                <th className="table-th">Contact</th>
                <th className="table-th">Segment</th>
                <th className="table-th">Modules</th>
                <th className="table-th">Machines</th>
                <th className="table-th">Revenue</th>
                <th className="table-th"></th>
              </tr>
            </thead>
            <tbody>
              {filteredVendors.length === 0 ? (
                <tr>
                  <td colSpan={7} className="table-td text-center text-gray-400 py-8">
                    {search ? "No vendors match your search" : "No vendors yet"}
                  </td>
                </tr>
              ) : (
                filteredVendors.map((v) => (
                  <tr key={v.id}>
                    <td className="table-td">
                      <span className="font-medium">{vendorLabel(v)}</span>
                      <span className="block text-xs text-gray-400">
                        {TYPE_LABEL[v.institution_type] || "—"}
                        {v.status && v.status !== "ACTIVE" && ` · ${v.status}`}
                      </span>
                    </td>
                    <td className="table-td text-gray-600">
                      {v.full_name}
                      {v.contact_designation && <span className="text-gray-400"> · {v.contact_designation}</span>}
                      <span className="block text-xs text-gray-400">
                        {[v.phone, v.email].filter(Boolean).join(" · ")}
                      </span>
                    </td>
                    <td className="table-td"><SegmentBadge segment={v.segment} /></td>
                    <td className="table-td">
                      <div className="flex flex-wrap gap-1">
                        {String(v.allowed_modules || "KIOSK").split(",").map((m) => <ModuleBadge key={m} module={m} />)}
                      </div>
                    </td>
                    <td className="table-td">{v.machine_count}</td>
                    <td className="table-td">₹{Number(v.total_revenue || 0).toLocaleString("en-IN")}</td>
                    <td className="table-td text-right">
                      <Link to={`/admin/vendors/${v.id}`} className="text-brand-600 hover:text-brand-700 text-sm font-medium">
                        View →
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        </div>
      )}
    </DashboardLayout>
  );
}