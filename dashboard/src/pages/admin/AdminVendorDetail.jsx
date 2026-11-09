import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { adminApi } from "../../api/admin.api";
import DashboardLayout from "../../components/DashboardLayout";
import StatusBadge from "../../components/StatusBadge";
import Loader from "../../components/Loader";
import ModuleBadge, { MODULE_INFO, parseModules } from "../../components/ModuleBadge";
import { SegmentBadge, SEGMENTS } from "../../components/ui";

const TYPE_LABEL = {
  COLLEGE: "College", UNIVERSITY: "University", SCHOOL: "School", COACHING: "Coaching institute",
  SHOP: "Shop / business", GOVERNMENT_OFFICE: "Government office", BANK: "Bank branch", PSU_OFFICE: "PSU office", OTHER: "Other",
};
function InfoItem({ label, children }) {
  return (
    <div>
      <dt className="text-xs text-gray-400">{label}</dt>
      <dd className="text-sm text-gray-700 break-words">{children || "—"}</dd>
    </div>
  );
}
/* Contact and billing details (from the live dashboard). */
function VendorInfo({ vendor }) {
  return (
    <div className="card p-5 mb-6">
      <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <InfoItem label="Type">{TYPE_LABEL[vendor.institution_type]}</InfoItem>
        <InfoItem label="Contact person">
          {vendor.full_name}
          {vendor.contact_designation && <span className="block text-xs text-gray-400">{vendor.contact_designation}</span>}
        </InfoItem>
        <InfoItem label="Phone">
          {vendor.phone || vendor.alt_phone ? (
            <>
              {vendor.phone && <a href={`tel:${vendor.phone}`} className="block text-brand-600 hover:text-brand-700">{vendor.phone}</a>}
              {vendor.alt_phone && <a href={`tel:${vendor.alt_phone}`} className="block text-xs text-brand-600 hover:text-brand-700">Alt: {vendor.alt_phone}</a>}
            </>
          ) : null}
        </InfoItem>
        <InfoItem label="Login email">{vendor.email}</InfoItem>
        <InfoItem label="Billing address">{vendor.billing_address || vendor.address}</InfoItem>
        <InfoItem label="GST / PAN">{[vendor.gst_number, vendor.pan_number].filter(Boolean).join(" · ") || null}</InfoItem>
      </dl>
    </div>
  );
}

export default function AdminVendorDetail() {
  const { vendorId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [moduleError, setModuleError] = useState("");
  const [savingModules, setSavingModules] = useState(false);

  const load = () => adminApi.getVendorDetail(vendorId).then(setData).finally(() => setLoading(false));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId]);

  const toggleModule = async (key) => {
    const current = parseModules(data.vendor.allowed_modules);
    const next = current.includes(key) ? current.filter((m) => m !== key) : [...current, key];
    if (!next.length) return;
    setModuleError("");
    setSavingModules(true);
    try {
      await adminApi.updateVendor(vendorId, { allowedModules: next });
      await load();
    } catch (err) {
      setModuleError(err?.response?.data?.error || "Could not update modules");
    } finally {
      setSavingModules(false);
    }
  };

  const saveVendor = async (payload) => {
    setModuleError("");
    try {
      await adminApi.updateVendor(vendorId, payload);
      await load();
    } catch (err) {
      setModuleError(err?.response?.data?.error || "Could not save");
    }
  };

  if (loading) return <DashboardLayout><Loader /></DashboardLayout>;
  if (!data) return <DashboardLayout><p className="text-sm text-gray-400">Vendor not found</p></DashboardLayout>;

  const { vendor, machines, bank } = data;
  const totalRevenue = machines.reduce((s, m) => s + Number(m.revenue || 0), 0);

  return (
    <DashboardLayout>
      <Link to="/admin/vendors" className="text-sm text-gray-500 hover:text-gray-700">
        ← Back to vendors
      </Link>

      <div className="flex items-start justify-between mt-2 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-800">{vendor.full_name}</h1>
          <p className="text-sm text-gray-500">{vendor.email} {vendor.phone ? `· ${vendor.phone}` : ""}</p>
          {vendor.business_name && <p className="text-sm text-gray-500">{vendor.business_name}</p>}
        </div>
        <div className="flex items-center gap-2">
          <SegmentBadge segment={vendor.segment} />
          <StatusBadge status={vendor.status} />
        </div>
      </div>

      <VendorInfo vendor={vendor} />

      <div className="card p-5 mb-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Customer segment</label>
          <select className="input" value={vendor.segment} onChange={(e) => saveVendor({ segment: e.target.value })}>
            {Object.entries(SEGMENTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Strict privacy</label>
          <select
            className="input"
            value={vendor.strict_privacy === null || vendor.strict_privacy === undefined ? "auto" : vendor.strict_privacy ? "on" : "off"}
            onChange={(e) => saveVendor({ strictPrivacy: e.target.value === "auto" ? null : e.target.value === "on" })}
          >
            <option value="auto">Automatic (on for Government / PSU)</option>
            <option value="on">Always on — don't store file names</option>
            <option value="off">Off</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Account status</label>
          <select className="input" value={vendor.status} onChange={(e) => saveVendor({ status: e.target.value })}>
            {["ACTIVE", "INACTIVE", "SUSPENDED"].map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="card p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Modules</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Object.entries(MODULE_INFO).map(([key, info]) => {
            const on = parseModules(vendor.allowed_modules).includes(key);
            return (
              <label key={key} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer ${on ? "border-brand-300 bg-brand-50" : "border-gray-200"}`}>
                <input type="checkbox" className="mt-0.5" checked={on} disabled={savingModules} onChange={() => toggleModule(key)} />
                <span>
                  <span className="block text-sm font-medium text-gray-800">{info.long}</span>
                  <span className="block text-xs text-gray-500">{info.hint}</span>
                </span>
              </label>
            );
          })}
        </div>
        {moduleError && <p className="text-sm text-red-600 mt-2">{moduleError}</p>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="card p-5">
          <p className="text-sm text-gray-500">Machines owned</p>
          <p className="mt-2 text-2xl font-semibold text-brand-700">{machines.length}</p>
        </div>
        <div className="card p-5">
          <p className="text-sm text-gray-500">Lifetime revenue</p>
          <p className="mt-2 text-2xl font-semibold text-green-700">₹{totalRevenue.toLocaleString("en-IN")}</p>
        </div>
        <div className="card p-5">
          <p className="text-sm text-gray-500">Bank account</p>
          <p className="mt-2 text-sm font-medium">
            {bank ? (
              <>
                {bank.bank_name} · {bank.account_number}
                {bank.verified ? (
                  <span className="ml-2 text-xs text-green-600">Verified</span>
                ) : (
                  <span className="ml-2 text-xs text-amber-600">Unverified</span>
                )}
              </>
            ) : (
              <span className="text-gray-400">Not added yet</span>
            )}
          </p>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">Machines</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="table-th">Machine</th>
              <th className="table-th">Module</th>
              <th className="table-th">Status</th>
              <th className="table-th">Prints</th>
              <th className="table-th">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {machines.length === 0 ? (
              <tr>
                <td colSpan={5} className="table-td text-center text-gray-400 py-8">
                  No machines assigned yet
                </td>
              </tr>
            ) : (
              machines.map((m) => (
                <tr key={m.machine_id}>
                  <td className="table-td font-medium">
                    <Link to={`/admin/machines/${m.machine_id}`} className="text-brand-600 hover:text-brand-700">
                      {m.name || m.machine_id}
                    </Link>
                  </td>
                  <td className="table-td"><ModuleBadge module={m.module} /></td>
                  <td className="table-td"><StatusBadge status={m.status} /></td>
                  <td className="table-td">{m.total_prints}</td>
                  <td className="table-td">₹{Number(m.revenue).toLocaleString("en-IN")}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
      </div>
    </DashboardLayout>
  );
}
