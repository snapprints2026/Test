// Small shared UI pieces for the dashboard (Tailwind).
import React, { useEffect } from "react";

export const money = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
export const fmtDateTime = (d) => (d ? new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");
export const fmtMinutes = (m) => {
  if (m === null || m === undefined) return "—";
  const n = Number(m);
  if (n < 60) return `${n} min`;
  if (n < 1440) return `${Math.floor(n / 60)} h ${n % 60} min`;
  return `${Math.floor(n / 1440)} d ${Math.floor((n % 1440) / 60)} h`;
};
export const todayYmd = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
export const monthStartYmd = (offset = 0) => {
  const d = new Date(Date.now() + 330 * 60000);
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1));
  return m.toISOString().slice(0, 10);
};
export const monthEndYmd = (offset = 0) => {
  const d = new Date(Date.now() + 330 * 60000);
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset + 1, 0));
  return m.toISOString().slice(0, 10);
};

export function PageHeader({ title, sub, children }) {
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap mb-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-800">{title}</h1>
        {sub && <p className="text-sm text-gray-500 mt-0.5">{sub}</p>}
      </div>
      {children && <div className="flex items-center gap-2 flex-wrap">{children}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = "", bodyClass = "p-5" }) {
  return (
    <div className={`card overflow-hidden ${className}`}>
      {(title || actions) && (
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
          {title && <h2 className="text-sm font-semibold text-gray-700">{title}</h2>}
          {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
        </div>
      )}
      <div className={bodyClass}>{children}</div>
    </div>
  );
}

export function Field({ label, hint, children, className = "" }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-xs font-medium text-gray-600 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-gray-400 mt-1">{hint}</span>}
    </label>
  );
}

export function Table({ head, children, empty = "Nothing here yet", colSpan }) {
  const rows = React.Children.toArray(children).filter(Boolean);
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-gray-50">
          <tr>{head.map((h, i) => <th key={i} className="table-th">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length ? rows : (
            <tr><td colSpan={colSpan || head.length} className="table-td text-center text-gray-400 py-8">{empty}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Modal({ open, title, onClose, children, wide = false }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className={`card w-full ${wide ? "max-w-3xl" : "max-w-lg"} mt-10 mb-10`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none px-1" aria-label="Close">✕</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function ErrorText({ children }) {
  if (!children) return null;
  return <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{children}</p>;
}

const PILL = {
  gray: "bg-gray-100 text-gray-600", green: "bg-green-100 text-green-700", amber: "bg-amber-100 text-amber-700",
  red: "bg-red-100 text-red-700", blue: "bg-blue-100 text-blue-700", violet: "bg-violet-100 text-violet-700",
  teal: "bg-teal-100 text-teal-700", brand: "bg-brand-100 text-brand-700", orange: "bg-orange-100 text-orange-700",
};
export function Pill({ color = "gray", children, title }) {
  return <span title={title} className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${PILL[color] || PILL.gray}`}>{children}</span>;
}

export const SEGMENTS = {
  EDUCATION: { label: "Education", color: "blue" },
  RETAIL: { label: "Retail", color: "gray" },
  GOVERNMENT: { label: "Government", color: "orange" },
  PSU: { label: "PSU", color: "violet" },
};
export function SegmentBadge({ segment }) {
  const s = SEGMENTS[segment] || SEGMENTS.EDUCATION;
  return <Pill color={s.color}>{s.label}</Pill>;
}

export const JOB_TYPES = {
  PRINT: { label: "Print", color: "gray" },
  FORM: { label: "Form", color: "brand" },
  COPY: { label: "Photocopy", color: "teal" },
  SCAN: { label: "Scan", color: "violet" },
};
export function JobTypeBadge({ type }) {
  const j = JOB_TYPES[type] || JOB_TYPES.PRINT;
  return <Pill color={j.color}>{j.label}</Pill>;
}

export const CONTRACT_TYPES = {
  SALE: "Sale + warranty / AMC",
  REVENUE_SHARE: "Revenue share",
  PAY_PER_USE: "Pay per use (billed monthly)",
  RENTAL: "Monthly rental",
};

export function Stat({ label, value, sub, tone = "text-brand-700" }) {
  return (
    <div className="card p-5">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${tone}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

/* Load data once (and on demand): const { data, loading, error, reload } = useLoad(fn, deps) */
export function useLoad(fn, deps = []) {
  const [state, setState] = React.useState({ data: null, loading: true, error: "" });
  const reload = React.useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    return fn()
      .then((data) => setState({ data, loading: false, error: "" }))
      .catch((err) => setState({ data: null, loading: false, error: err?.response?.data?.error || err.message || "Failed to load" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}

/* Organisation <select> with indentation (from a tree-ordered list) */
export function OrgSelect({ orgs, value, onChange, placeholder = "— none —", className = "input", required = false, exclude }) {
  return (
    <select className={className} value={value || ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} required={required}>
      <option value="">{placeholder}</option>
      {(orgs || []).filter((o) => o.id !== exclude).map((o) => (
        <option key={o.id} value={o.id}>{`${"  ".repeat(o.depth || 0)}${o.depth ? "└ " : ""}${o.name}${o.office_code ? ` (${o.office_code})` : ""}`}</option>
      ))}
    </select>
  );
}
