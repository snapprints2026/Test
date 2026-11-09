import React, { useEffect, useState } from "react";
import { adminApi } from "../../api/admin.api";
import DashboardLayout from "../../components/DashboardLayout";
import StatusBadge from "../../components/StatusBadge";
import Loader from "../../components/Loader";

/* "Paid but didn't get the print" — review queue + support search.
   Most cases never reach this page: expired OTPs and printer errors are
   refunded automatically. What lands here:
     - customer says it didn't print, but the kiosk reported PRINTED / PRINTING
     - SYSTEM "STUCK": kiosk never reported printed/failed (crash, power cut)
     - refunds that failed at Razorpay (retry with "Refund now")              */

const TABS = ["OPEN", "APPROVED", "AUTO_APPROVED", "REJECTED", "ALL"];

const REASON_LABELS = {
  NOTHING_PRINTED: "Nothing printed",
  MISSING_PAGES: "Pages missing",
  BAD_QUALITY: "Bad print quality",
  MACHINE_ERROR: "Machine showed an error",
  STUCK: "Device never confirmed (stuck)",
  OTHER: "Other",
};

const EVENT_LABELS = {
  JOB_PAID: "Paid",
  JOB_UNLOCKED: "OTP entered on kiosk",
  JOB_PRINTING: "Shop computer started printing",
  JOB_PRINTED: "Machine reported PRINTED",
  JOB_FAILED: "Failed",
  JOB_REFUNDED: "Refunded",
  FILE_DELETED: "Document deleted",
  REFUND_FAILED: "Refund attempt failed",
  UNLOCK_FAILED: "Wrong OTP entered",
};

const fmt = (d) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
const errMsg = (err, fallback) => err?.response?.data?.error || fallback;

function Field({ label, children }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className="text-sm text-gray-800 break-all">{children || "—"}</p>
    </div>
  );
}

/* Everything known about one job — shared by issue cards and search results */
function JobEvidence({ job }) {
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Field label="Reference">{job.ref_code}</Field>
        <Field label="Customer">
          {job.customer_phone || job.payer_contact
            ? `${job.customer_name ? job.customer_name + " · " : ""}${job.customer_phone || job.payer_contact}`
            : "Guest"}
        </Field>
        <Field label="Machine">{job.machine_name ? `${job.machine_name} (${job.machine_id})` : job.machine_id}</Field>
        <Field label="Amount">{job.amount != null ? `₹${Number(job.amount)}` : null}</Field>
        <Field label="Job">
          <StatusBadge status={job.job_status} />{" "}
          <span className="text-xs text-gray-500">
            {job.total_pages} pg × {job.copies} · {job.color === "bw" ? "B/W" : "Colour"}
          </span>
        </Field>
        <Field label="Payment">
          {job.payment_method ? job.payment_method.toUpperCase() : null}
          {job.utr ? ` · UTR ${job.utr}` : ""}
        </Field>
        <Field label="Refund">
          {job.refund_status ? (
            <>
              <StatusBadge status={job.refund_status} />{" "}
              {job.refund_amount ? `₹${Number(job.refund_amount)}` : ""}
            </>
          ) : (
            "Not refunded"
          )}
        </Field>
        <Field label="Created">{fmt(job.job_created_at)}</Field>
      </div>

      {job.refund_status === "FAILED" && job.refund_reason ? (
        <p className="mt-2 text-xs text-red-600">Last refund attempt: {job.refund_reason}</p>
      ) : null}

      {job.events?.length ? (
        <div className="mt-3">
          <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">Timeline</p>
          <ol className="text-xs text-gray-600 space-y-0.5">
            {job.events.map((e, i) => (
              <li key={i}>
                <span className="text-gray-400 mr-2">{fmt(e.at)}</span>
                {EVENT_LABELS[e.event] || e.event}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </>
  );
}

function IssueCard({ issue, busy, onApprove, onReject }) {
  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <StatusBadge status={issue.status} />
          <span className="font-semibold text-gray-800">{REASON_LABELS[issue.reason] || issue.reason}</span>
          {issue.source === "SYSTEM" ? (
            <span className="text-xs text-gray-500">· raised by system</span>
          ) : null}
        </div>
        <span className="text-xs text-gray-400">Reported {fmt(issue.created_at)}</span>
      </div>

      {issue.details ? (
        <p className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2 mb-3">“{issue.details}”</p>
      ) : null}

      <JobEvidence job={issue} />

      {issue.resolution_note ? (
        <p className="mt-3 text-xs text-gray-500">Note: {issue.resolution_note}</p>
      ) : null}

      {issue.status === "OPEN" ? (
        <div className="flex gap-2 mt-4">
          <button className="btn-primary" disabled={busy} onClick={() => onApprove(issue)}>
            Approve & refund ₹{Number(issue.amount)}
          </button>
          <button className="btn-secondary" disabled={busy} onClick={() => onReject(issue)}>
            Reject
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function AdminIssues() {
  const [tab, setTab] = useState("OPEN");
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const [q, setQ] = useState("");
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  const load = () => {
    setLoading(true);
    adminApi
      .getIssues(tab)
      .then(setIssues)
      .catch((err) => alert(errMsg(err, "Failed to load issues")))
      .finally(() => setLoading(false));
  };
  useEffect(load, [tab]);

  const approve = async (issue) => {
    if (!window.confirm(`Refund ₹${Number(issue.amount)} for ${issue.ref_code || issue.job_id}? This cannot be undone.`)) return;
    setBusyId(issue.id);
    try {
      await adminApi.resolveIssue(issue.id, "APPROVE", "");
      load();
    } catch (err) {
      alert(errMsg(err, "Refund failed"));
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (issue) => {
    const note = window.prompt("Reason for rejecting (the customer is told the machine confirmed printing):");
    if (note === null) return;
    setBusyId(issue.id);
    try {
      await adminApi.resolveIssue(issue.id, "REJECT", note);
      load();
    } catch (err) {
      alert(errMsg(err, "Failed to update"));
    } finally {
      setBusyId(null);
    }
  };

  const search = async (e) => {
    e.preventDefault();
    setSearchError("");
    if (q.trim().length < 4) {
      setSearchError("Type at least 4 characters");
      return;
    }
    setSearching(true);
    try {
      setResults(await adminApi.searchJobs(q.trim()));
    } catch (err) {
      setSearchError(errMsg(err, "Search failed"));
    } finally {
      setSearching(false);
    }
  };

  const refundFromSearch = async (job) => {
    if (!window.confirm(`Refund ₹${Number(job.amount)} for ${job.ref_code || job.job_id}? This cannot be undone.`)) return;
    setBusyId(job.job_id);
    try {
      await adminApi.refundJob(job.job_id);
      setResults(await adminApi.searchJobs(q.trim()));
      load();
    } catch (err) {
      alert(errMsg(err, "Refund failed"));
    } finally {
      setBusyId(null);
    }
  };

  const openCase = async (job) => {
    const details = window.prompt("What did the customer say?", "Customer contacted support");
    if (details === null) return;
    setBusyId(job.job_id);
    try {
      await adminApi.openIssue(job.job_id, "NOTHING_PRINTED", details);
      setResults(await adminApi.searchJobs(q.trim()));
      if (tab === "OPEN") load();
    } catch (err) {
      alert(errMsg(err, "Could not open the case"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <DashboardLayout>
      <h1 className="text-xl font-semibold text-gray-800 mb-1">Issues & Refunds</h1>
      <p className="text-sm text-gray-500 mb-6">
        Expired OTPs and printer errors are refunded automatically. Cases below need a decision.
      </p>

      {/* Support search */}
      <form onSubmit={search} className="card p-4 mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">Find a payment</label>
        <div className="flex gap-2">
          <input
            className="input"
            placeholder="Reference (SP-…), UPI ref / UTR, phone number, job ID or Razorpay payment ID"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="btn-primary whitespace-nowrap" disabled={searching}>
            {searching ? "Searching…" : "Search"}
          </button>
        </div>
        {searchError ? <p className="text-xs text-red-600 mt-2">{searchError}</p> : null}

        {results ? (
          <div className="mt-4 space-y-3">
            {results.length === 0 ? (
              <p className="text-sm text-gray-400">No payments found.</p>
            ) : (
              results.map((job) => (
                <div key={job.job_id} className="border border-gray-200 rounded-lg p-3">
                  <JobEvidence job={job} />
                  <div className="flex flex-wrap items-center gap-3 mt-3">
                    {job.issue_status ? (
                      <span className="text-xs text-gray-500">
                        Case: <StatusBadge status={job.issue_status} />
                      </span>
                    ) : null}
                    {job.payment_id && !job.issue_id && (!job.refund_status || job.refund_status === "FAILED") ? (
                      <button className="btn-secondary" disabled={busyId === job.job_id} onClick={() => openCase(job)}>
                        Open a case
                      </button>
                    ) : null}
                    {job.payment_id && (!job.refund_status || job.refund_status === "FAILED") ? (
                      <button className="btn-primary" disabled={busyId === job.job_id} onClick={() => refundFromSearch(job)}>
                        {job.refund_status === "FAILED" ? "Retry refund" : "Refund now"}
                      </button>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        ) : null}
      </form>

      {/* Queue */}
      <div className="inline-flex flex-wrap bg-gray-100 rounded-lg p-1 mb-4">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition capitalize ${
              tab === t ? "bg-white shadow-sm text-brand-700" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.replace("_", " ").toLowerCase()}
          </button>
        ))}
      </div>

      {loading ? (
        <Loader />
      ) : issues.length === 0 ? (
        <div className="card p-8 text-center text-sm text-gray-400">No cases here 🎉</div>
      ) : (
        <div className="space-y-4">
          {issues.map((issue) => (
            <IssueCard
              key={issue.id}
              issue={issue}
              busy={busyId === issue.id}
              onApprove={approve}
              onReject={reject}
            />
          ))}
        </div>
      )}
    </DashboardLayout>
  );
}