// parts/ReportIssue.jsx — "Didn't get your print?" (from the live app).
// Used after an order and in My Account → History. The customer only picks
// what went wrong — the backend already has the job, payment, machine and
// timings. Failed / expired orders are refunded automatically; for printed
// orders the report goes to the admin's refund queue.
import React, { useState } from "react";
import * as jobApi from "../../../api/job.api";
import { useT } from "../../../i18n";

const REASONS = ["NOTHING_PRINTED", "MISSING_PAGES", "BAD_QUALITY", "MACHINE_ERROR", "OTHER"];

export default function ReportIssue({ jobId, refCode, onClose, onReported }) {
  const { t } = useT();
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!reason) {
      setError(t("issue.pick"));
      return;
    }
    setError("");
    setSending(true);
    try {
      const r = await jobApi.reportIssue(jobId, { reason, details: details.trim() });
      setResult(r);
      onReported?.(r);
    } catch (err) {
      setError(err.message || t("errors.generic"));
    } finally {
      setSending(false);
    }
  };

  if (result) {
    const approved = result.issueStatus === "AUTO_APPROVED" || result.issueStatus === "APPROVED";
    const msg = result.ticketNo ? t("issue.office") : approved ? t("issue.approved") : t("issue.open");
    return (
      <div className="pf-report" role="status">
        <div className={`pf-alert ${approved ? "success" : "info"}`}>{approved ? "✓ " : ""}{msg}</div>
        {refCode ? <p className="pf-report-ref">{t("issue.ref")} <strong>{refCode}</strong></p> : null}
        {onClose ? <button type="button" className="pf-link-btn" onClick={onClose}>{t("history.close")}</button> : null}
      </div>
    );
  }

  return (
    <form className="pf-report" onSubmit={submit}>
      <p className="pf-report-title" id={`pf-issue-${jobId}`}>{t("issue.title")}</p>
      <div className="pf-report-options" role="radiogroup" aria-labelledby={`pf-issue-${jobId}`}>
        {REASONS.map((r) => (
          <label key={r} className={`pf-report-option ${reason === r ? "selected" : ""}`}>
            <input type="radio" name={`reason-${jobId}`} value={r} checked={reason === r} onChange={() => setReason(r)} />
            {t(`issue.reason.${r}`)}
          </label>
        ))}
      </div>
      <textarea
        className="pf-report-details"
        placeholder={t("issue.details")}
        aria-label={t("issue.details")}
        maxLength={500}
        rows={2}
        value={details}
        onChange={(e) => setDetails(e.target.value)}
      />
      {error ? <div className="pf-alert error" role="alert">⚠ {error}</div> : null}
      <div className="pf-report-actions">
        {onClose ? <button type="button" className="pf-btn ghost" onClick={onClose} disabled={sending}>{t("report.cancel")}</button> : null}
        <button type="submit" className="pf-btn primary pf-report-submit" disabled={sending}>
          {sending ? <><span className="pf-spinner" /> {t("report.sending")}</> : t("issue.send")}
        </button>
      </div>
    </form>
  );
}
