import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { adminApi } from "../../api/admin.api";
import DashboardLayout from "../../components/DashboardLayout";
import StatusBadge from "../../components/StatusBadge";
import Loader from "../../components/Loader";
import ModuleBadge, { MODULE_INFO } from "../../components/ModuleBadge";
import SetupCodeCard from "../../components/SetupCodeCard";
import { JOB_TYPES, JobTypeBadge, OrgSelect, SegmentBadge } from "../../components/ui";

const DAY_LABELS = { MON: "Mon", TUE: "Tue", WED: "Wed", THU: "Thu", FRI: "Fri", SAT: "Sat", SUN: "Sun" };
function timingsLabel(m) {
  const hours = m.open_time && m.close_time ? `${String(m.open_time).slice(0, 5)}–${String(m.close_time).slice(0, 5)}` : null;
  const off = m.weekly_off ? `closed ${m.weekly_off.split(",").map((d) => DAY_LABELS[d] || d).join(", ")}` : null;
  return [hours, off].filter(Boolean).join(", ") || "24 × 7";
}
function InfoItem({ label, children }) {
  return (
    <div>
      <dt className="text-xs text-gray-400">{label}</dt>
      <dd className="text-sm text-gray-700">{children || "—"}</dd>
    </div>
  );
}

/* Where the machine is and who to call (from the live dashboard). */
function LocationCard({ machine }) {
  const hasPin = machine.latitude != null && machine.longitude != null;
  const postal = [machine.address, machine.city, machine.state, machine.pincode].filter(Boolean).join(", ");
  return (
    <div className="card p-5 mb-6">
      <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <InfoItem label="Location">
          {machine.location_label || machine.location_name}
          {machine.landmark && <span className="block text-xs text-gray-400">Near {machine.landmark}</span>}
        </InfoItem>
        <InfoItem label="Address">
          {postal || null}
          {hasPin && (
            <a href={`https://www.google.com/maps?q=${machine.latitude},${machine.longitude}`} target="_blank" rel="noreferrer"
              className="block text-xs text-brand-600 hover:text-brand-700">Open in Google Maps →</a>
          )}
        </InfoItem>
        <InfoItem label="On-site contact">
          {machine.contact_name || machine.contact_phone ? (
            <>
              {machine.contact_name}
              {machine.contact_phone && <a href={`tel:${machine.contact_phone}`} className="block text-xs text-brand-600 hover:text-brand-700">{machine.contact_phone}</a>}
            </>
          ) : null}
        </InfoItem>
        <InfoItem label="Timings">{timingsLabel(machine)}</InfoItem>
        <InfoItem label="Vendor">
          {machine.owner_vendor_id ? (
            <Link to={`/admin/vendors/${machine.owner_vendor_id}`} className="text-brand-600 hover:text-brand-700">{machine.vendor_business_name || machine.vendor_name}</Link>
          ) : "Unassigned"}
        </InfoItem>
        <InfoItem label="Printer / installed">
          {[machine.printer_model, machine.installed_at && `since ${String(machine.installed_at).slice(0, 10)}`].filter(Boolean).join(", ") || null}
        </InfoItem>
      </dl>
      <p className="text-xs text-gray-400 mt-3">Edit the location from Machines → Edit.</p>
    </div>
  );
}

const LANGS = { "": "Phone's language", en: "English", hi: "हिन्दी (Hindi)", mr: "मराठी (Marathi)" };

/* Government / institution settings — organisation, contract, services, billing,
   staff code, language, asset details and office hours. */
function GovSettingsCard({ machine, onSave, saving }) {
  const [orgs, setOrgs] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [pin, setPin] = useState("");
  const [assets, setAssets] = useState({
    assetTag: machine.asset_tag || "",
    printerModel: machine.printer_model || "",
    installedAt: machine.installed_at ? String(machine.installed_at).slice(0, 10) : "",
  });
  const [hours, setHours] = useState({
    openTime: machine.open_time ? String(machine.open_time).slice(0, 5) : "",
    closeTime: machine.close_time ? String(machine.close_time).slice(0, 5) : "",
    openDays: machine.open_days || "1,2,3,4,5,6",
  });
  useEffect(() => {
    Promise.all([adminApi.getOrganizations(), adminApi.getContracts()]).then(([o, c]) => { setOrgs(o); setContracts(c); }).catch(() => {});
  }, []);
  const jobTypes = String(machine.enabled_job_types || "PRINT").split(",").filter(Boolean);
  const toggleJob = (k) => {
    const next = jobTypes.includes(k) ? jobTypes.filter((x) => x !== k) : [...jobTypes, k];
    if (!next.length) return;
    onSave({ enabledJobTypes: next });
  };
  const orgContracts = contracts.filter((c) => !machine.organization_id || c.organization_id === machine.organization_id);

  return (
    <div className="card p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-700">Government / institution</h2>
        {machine.vendor_segment && <SegmentBadge segment={machine.vendor_segment} />}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Organisation / office</label>
          <OrgSelect orgs={orgs} value={machine.organization_id} onChange={(v) => onSave({ organizationId: v || null })} />
          {machine.organization_id && <Link to={`/admin/organizations/${machine.organization_id}`} className="text-xs text-brand-600">Open office →</Link>}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Contract</label>
          <select className="input" disabled={saving} value={machine.contract_id || ""} onChange={(e) => onSave({ contractId: e.target.value || null })}>
            <option value="">— none —</option>
            {orgContracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no} · {c.contract_type.replace("_", " ").toLowerCase()}</option>)}
          </select>
          {machine.contract_id && <Link to={`/admin/contracts/${machine.contract_id}`} className="text-xs text-brand-600">Open contract →</Link>}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Who pays</label>
          <select
            className="input"
            disabled={saving}
            value={machine.billing_mode || "CUSTOMER"}
            onChange={(e) => {
              if (window.confirm(e.target.value === "DEPARTMENT"
                ? "Bill the department monthly? Citizens will not pay at the machine; staff enter a counter code instead."
                : "Switch to citizens paying at the machine?")) onSave({ billingMode: e.target.value });
            }}
          >
            <option value="CUSTOMER">Citizen pays (UPI / card)</option>
            <option value="DEPARTMENT">Department pays — monthly invoice</option>
          </select>
        </div>
      </div>

      <div className="mt-5">
        <label className="block text-xs font-medium text-gray-600 mb-2">Services offered</label>
        <div className="flex flex-wrap gap-4">
          {Object.entries(JOB_TYPES).map(([k, v]) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <input type="checkbox" disabled={saving} checked={jobTypes.includes(k)} onChange={() => toggleJob(k)} /> {v.label}
            </label>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-1">Photocopy and scan are done by counter staff on a multifunction printer (kiosk firmware / shop agent 1.1+).</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-5">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Counter staff code {machine.has_staff_pin ? "(set)" : "(not set)"}</label>
          <div className="flex gap-2">
            <input className="input" inputMode="numeric" maxLength={8} placeholder="4–8 digits" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
            <button className="btn-secondary" disabled={saving || pin.length < 4} onClick={() => { onSave({ staffPin: pin }); setPin(""); }}>Set</button>
            {!!machine.has_staff_pin && <button className="btn-secondary" disabled={saving} onClick={() => window.confirm("Remove the staff code?") && onSave({ staffPin: null })}>Remove</button>}
          </div>
          <p className="text-xs text-gray-400 mt-1">Needed for department-billed jobs. Stored hashed.</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Default language on the customer page</label>
          <select className="input" disabled={saving} value={machine.default_language || ""} onChange={(e) => onSave({ defaultLanguage: e.target.value || null })}>
            {Object.entries(LANGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Office hours (IST) — for SLA</label>
          <div className="flex gap-2">
            <input type="time" className="input" value={hours.openTime} onChange={(e) => setHours((h) => ({ ...h, openTime: e.target.value }))} />
            <input type="time" className="input" value={hours.closeTime} onChange={(e) => setHours((h) => ({ ...h, closeTime: e.target.value }))} />
          </div>
          <div className="flex gap-2 mt-2">
            <select className="input" value={hours.openDays} onChange={(e) => setHours((h) => ({ ...h, openDays: e.target.value }))}>
              <option value="1,2,3,4,5,6">Mon–Sat</option>
              <option value="1,2,3,4,5">Mon–Fri</option>
              <option value="1,2,3,4,5,6,7">Every day</option>
            </select>
            <button className="btn-secondary" disabled={saving} onClick={() => onSave(hours)}>Save</button>
          </div>
          <p className="text-xs text-gray-400 mt-1">Empty = 24 × 7.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-5 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Asset tag</label>
          <input className="input" value={assets.assetTag} onChange={(e) => setAssets((a) => ({ ...a, assetTag: e.target.value }))} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Printer model</label>
          <input className="input" value={assets.printerModel} onChange={(e) => setAssets((a) => ({ ...a, printerModel: e.target.value }))} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Installed on</label>
          <input type="date" className="input" value={assets.installedAt} onChange={(e) => setAssets((a) => ({ ...a, installedAt: e.target.value }))} />
        </div>
        <button className="btn-secondary" disabled={saving} onClick={() => onSave(assets)}>Save asset details</button>
      </div>
    </div>
  );
}

const FLAG_INFO = {
  REFUNDED: {
    label: "Refunded",
    className: "bg-green-100 text-green-700 border border-green-200",
    hint: "The money went back to the customer (automatic refund or Issues & refunds).",
  },
  PAID_NOT_VERIFIED: {
    label: "Paid, OTP never entered",
    className: "bg-orange-100 text-orange-700 border border-orange-200",
    hint: "Payment succeeded but the OTP window expired before it was used. It is refunded automatically; refund here if that failed.",
  },
  STUCK_PRINTING: {
    label: "Stuck in printing",
    className: "bg-red-100 text-red-700 border border-red-200",
    hint: "The job was sent to the machine, but there's been no print/fail confirmation in 15+ minutes. Check the machine (kiosk) or the shop screen (shop computer).",
  },
  FAILED: {
    label: "Marked failed",
    className: "bg-red-100 text-red-700 border border-red-200",
    hint: "Job was explicitly marked failed. A refund was attempted automatically if a payment had been captured.",
  },
};

const PAYMENT_METHOD_LABELS = {
  upi: "UPI",
  card: "Card",
  netbanking: "Net Banking",
  wallet: "Wallet",
  emi: "EMI",
};

function paymentLabel(job) {
  if (!job.payment_method) return "—";
  const base = PAYMENT_METHOD_LABELS[job.payment_method] || job.payment_method;
  if (job.payment_method === "upi" && job.payment_details?.vpa) return `${base} (${job.payment_details.vpa})`;
  if (job.payment_method === "card" && job.payment_details?.last4) {
    return `${base} •••• ${job.payment_details.last4}`;
  }
  return base;
}

const REFUND_ELIGIBLE_STATUSES = new Set(["PAID", "PRINTING", "EXPIRED"]);

export default function AdminMachineDetail() {
  const { machineId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refundingId, setRefundingId] = useState(null);
  const [refundError, setRefundError] = useState("");
  const [settingsError, setSettingsError] = useState("");
  const [saving, setSaving] = useState(false);
  const [setup, setSetup] = useState(null);

  const load = () => {
    setLoading(true);
    adminApi.getMachineJobs(machineId).then(setData).finally(() => setLoading(false));
  };

  useEffect(load, [machineId]);

  const handleRefund = async (job) => {
    if (!window.confirm(`Refund ₹${job.amount} for job ${job.job_id}? This cannot be undone.`)) return;
    setRefundError("");
    setRefundingId(job.job_id);
    try {
      await adminApi.refundJob(job.job_id);
      load();
    } catch (err) {
      setRefundError(err?.response?.data?.error || "Refund failed");
    } finally {
      setRefundingId(null);
    }
  };

  const saveSettings = async (payload) => {
    setSettingsError("");
    setSaving(true);
    try {
      await adminApi.updateMachineSettings(machineId, payload);
      load();
    } catch (err) {
      setSettingsError(err?.response?.data?.error || "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const handleNewCode = async () => {
    const msg = data?.machine?.status === "ACTIVE"
      ? "Create a new setup code? The device that is installed now keeps working until a new device registers with this code."
      : "Create a new setup code?";
    if (!window.confirm(msg)) return;
    try {
      const res = await adminApi.newSetupCode(machineId);
      setSetup(res.setup);
      load();
    } catch (err) {
      setSettingsError(err?.response?.data?.error || "Could not create a setup code");
    }
  };

  const togglePrinter = async (p) => {
    try {
      await adminApi.updatePrinter(p.id, { isEnabled: !p.is_enabled });
      load();
    } catch (err) {
      setSettingsError(err?.response?.data?.error || "Could not update printer");
    }
  };

  if (loading && !data) {
    return (
      <DashboardLayout>
        <Loader />
      </DashboardLayout>
    );
  }

  if (!data) {
    return (
      <DashboardLayout>
        <p className="text-sm text-gray-400">Machine not found</p>
      </DashboardLayout>
    );
  }

  const { machine, jobs, printers = [] } = data;
  const isShop = machine.module === "SHOP";
  const loginValue = machine.require_login === null || machine.require_login === undefined
    ? "default" : machine.require_login ? "true" : "false";
  const flaggedJobs = jobs.filter((j) => j.flag && j.flag !== "REFUNDED");
  const uniqueCustomers = new Set(jobs.filter((j) => j.customer_id).map((j) => j.customer_id)).size;

  return (
    <DashboardLayout>
      <Link to="/admin/machines" className="text-sm text-gray-500 hover:text-gray-700">
        ← Back to machines
      </Link>

      <div className="mt-2 mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-gray-800 flex items-center gap-2">
            {machine.name || machine.machine_id} <ModuleBadge module={machine.module} />
          </h1>
          <p className="text-sm text-gray-500">
            {machine.machine_id}
            {machine.location_name ? ` · ${machine.location_name}${machine.city ? `, ${machine.city}` : ""}` : ""}
            {" · "}{uniqueCustomers} unique customer{uniqueCustomers !== 1 ? "s" : ""} · {jobs.length} total jobs
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Vendor: {machine.vendor_name || "unassigned"}
            {machine.device_name ? ` · Device: ${machine.device_name}` : ""}
          </p>
        </div>
        <StatusBadge status={machine.status === "PENDING" ? "PENDING" : machine.is_online ? "ONLINE" : "OFFLINE"} />
      </div>

      {setup && <SetupCodeCard setup={setup} module={machine.module} onClose={() => setSetup(null)} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Settings</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Module</label>
              <select
                className="input"
                value={machine.module}
                disabled={saving}
                onChange={(e) => {
                  if (window.confirm(`Switch this machine to "${MODULE_INFO[e.target.value].long}"? The installed device must be the matching type.`))
                    saveSettings({ module: e.target.value });
                }}
              >
                {Object.entries(MODULE_INFO).map(([k, info]) => (
                  <option key={k} value={k}>{info.long}</option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">{MODULE_INFO[machine.module]?.hint}</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Customer login (mobile OTP)</label>
              <select
                className="input"
                value={loginValue}
                disabled={saving}
                onChange={(e) =>
                  saveSettings({ requireLogin: e.target.value === "default" ? null : e.target.value === "true" })
                }
              >
                <option value="default">Default (server setting)</option>
                <option value="false">Off — scan, upload, pay</option>
                <option value="true">Required before upload</option>
              </select>
            </div>
            <div className="flex items-center justify-between gap-3 pt-1">
              <p className="text-xs text-gray-500">
                {machine.status === "PENDING"
                  ? machine.setup_code_pending ? "Waiting for the device to register with its setup code." : "No device registered yet."
                  : "Device registered. A new setup code lets you install a replacement device."}
              </p>
              <button className="btn-secondary whitespace-nowrap" onClick={handleNewCode}>New setup code</button>
            </div>
            {settingsError && <p className="text-sm text-red-600">{settingsError}</p>}
          </div>
        </div>

        {isShop ? (
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Printers</h2>
            {printers.length === 0 ? (
              <p className="text-sm text-gray-400">
                No printers yet. They appear here after the shop computer runs the print agent setup.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {printers.map((p) => (
                  <li key={p.id} className="py-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-gray-800">
                        {p.display_name}
                        <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${p.kind === "COLOR" ? "bg-pink-100 text-pink-700" : "bg-gray-100 text-gray-700"}`}>
                          {p.kind === "COLOR" ? "Colour" : "B&W"}
                        </span>
                      </p>
                      <p className="text-xs text-gray-400">
                        {p.system_name} · {p.supports_duplex ? "double-sided" : "single-sided"} · {p.paper_sizes.join("/")}
                        {p.status_message ? ` · ${p.status_message}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={!p.is_enabled ? "PAUSED" : p.is_online ? "ONLINE" : "OFFLINE"} />
                      <button className="btn-secondary py-1 text-xs" onClick={() => togglePrinter(p)}>
                        {p.is_enabled ? "Pause" : "Resume"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-2">How it works</h2>
            <p className="text-sm text-gray-500">{MODULE_INFO.KIOSK.hint}</p>
          </div>
        )}
      </div>

      <LocationCard machine={machine} />

      <GovSettingsCard key={`${machine.organization_id}-${machine.contract_id}-${machine.open_time}-${machine.asset_tag}`} machine={machine} onSave={saveSettings} saving={saving} />

      {refundError && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
          {refundError}
        </div>
      )}

      {flaggedJobs.length > 0 && (
        <div className="card p-5 mb-6 border-red-200 bg-red-50/40">
          <h2 className="text-sm font-semibold text-red-800 mb-3">
            {flaggedJobs.length} job{flaggedJobs.length > 1 ? "s" : ""} need review
          </h2>
          <ul className="space-y-2">
            {flaggedJobs.map((j) => (
              <li key={j.job_id} className="text-sm text-gray-700 flex items-start gap-2">
                <span
                  className={`shrink-0 inline-block px-2 py-0.5 rounded-full text-xs font-medium ${FLAG_INFO[j.flag].className}`}
                >
                  {FLAG_INFO[j.flag].label}
                </span>
                <span className="text-gray-500">
                  {j.job_id} by {j.customer_name || "Unknown customer"} — {FLAG_INFO[j.flag].hint}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">Customers who used this machine</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="table-th">Job</th>
                {isShop && <th className="table-th">Code / printer</th>}
                <th className="table-th">Customer</th>
                <th className="table-th">Amount</th>
                <th className="table-th">Paid via</th>
                <th className="table-th">Status</th>
                <th className="table-th">Flag</th>
                <th className="table-th">Created</th>
                <th className="table-th"></th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={isShop ? 9 : 8} className="table-td text-center text-gray-400 py-8">
                    No print jobs on this machine yet
                  </td>
                </tr>
              ) : (
                jobs.map((j) => {
                  const canRefund = j.flag && j.flag !== "REFUNDED" && j.payment_id && REFUND_ELIGIBLE_STATUSES.has(j.status)
                    && (!j.refund_status || j.refund_status === "FAILED");
                  return (
                    <tr key={j.job_id}>
                      <td className="table-td font-medium">
                        {j.job_id}
                        {j.job_type && j.job_type !== "PRINT" && <span className="ml-2"><JobTypeBadge type={j.job_type} /></span>}
                        {j.billing === "DEPARTMENT" && <span className="block text-xs text-blue-600">billed to department</span>}
                        {j.fail_reason && <span className="block text-xs text-red-500">{j.fail_reason}</span>}
                      </td>
                      {isShop && (
                        <td className="table-td">
                          <span className="font-mono font-bold">{j.order_code || "—"}</span>
                          {j.printer_name && <span className="block text-xs text-gray-400">{j.printer_name}</span>}
                        </td>
                      )}
                      <td className="table-td text-gray-500">
                        {j.customer_id ? (
                          <Link to={`/admin/customers/${j.customer_id}`} className="text-brand-600 hover:text-brand-700">
                            {j.customer_name || "Unnamed"}
                          </Link>
                        ) : (
                          "—"
                        )}
                        {j.customer_phone && <span className="block text-xs text-gray-400">{j.customer_phone}</span>}
                      </td>
                      <td className="table-td">₹{Number(j.amount || 0).toLocaleString("en-IN")}</td>
                      <td className="table-td text-gray-500">{paymentLabel(j)}</td>
                      <td className="table-td">
                        <StatusBadge status={j.status} />
                      </td>
                      <td className="table-td">
                        {j.flag ? (
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${FLAG_INFO[j.flag].className}`}
                          >
                            {FLAG_INFO[j.flag].label}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                      <td className="table-td text-gray-500 whitespace-nowrap">
                        {new Date(j.created_at).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
                      </td>
                      <td className="table-td text-right">
                        {canRefund && (
                          <button
                            onClick={() => handleRefund(j)}
                            disabled={refundingId === j.job_id}
                            className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
                          >
                            {refundingId === j.job_id ? "Refunding..." : "Refund"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardLayout>
  );
}
