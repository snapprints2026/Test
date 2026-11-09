// parts/AfterActions.jsx — after the order: reference code, refund status,
// scan download, GST receipt, and "report a problem".
//   Paid online + printing / printed  → "Didn't get your print?" (refund queue)
//   Department / free orders, or no order yet → "Report a problem" (support ticket)
import React, { useState } from "react";
import { MdDownload, MdReceiptLong } from "react-icons/md";
import * as jobApi from "../../../api/job.api";
import { useT } from "../../../i18n";
import ReportProblem from "./ReportProblem";
import ReportIssue from "./ReportIssue";

/* What to tell the customer when the order didn't happen. */
function failureText(t, { status, refundStatus, refundAmount, billing }) {
  const why = status === "EXPIRED" ? t("refund.whyExpired") : t("refund.whyFailed");
  if (billing === "DEPARTMENT") return why; // nothing was paid at the machine
  const amount = refundAmount ? `₹${Number(refundAmount)}` : "";
  if (refundStatus === "PROCESSED" || refundStatus === "PENDING") return `${why} ${t("refund.done", { amount })}`;
  if (refundStatus === "FAILED") return `${why} ${t("refund.delayed")}`;
  return `${why} ${t("refund.auto")}`;
}

export default function AfterActions({ machineId, jobId, jobStatus, failed, refCode }) {
  const { t, lang } = useT();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [reporting, setReporting] = useState(false);
  const [issueStatus, setIssueStatus] = useState(null);
  const isScan = jobStatus?.jobType === "SCAN";
  const status = jobStatus?.status;
  const ref = jobStatus?.refCode || refCode;
  const issue = issueStatus || jobStatus?.issueStatus;
  const paidOnline = (jobStatus?.billing || "CUSTOMER") === "CUSTOMER" && !!ref;
  const canReportIssue = paidOnline && ["PRINTING", "PRINTED"].includes(status) && !issue && !jobStatus?.refundStatus;

  const openScan = async () => {
    setError("");
    setBusy("scan");
    try {
      const { url } = await jobApi.getScanLink(jobId);
      window.location.href = url; // signed, short-lived link → the PDF downloads
    } catch (err) {
      setError(err.message || t("errors.generic"));
    } finally {
      setBusy("");
    }
  };

  const receipt = async () => {
    setError("");
    setBusy("receipt");
    try {
      await jobApi.downloadReceipt(jobId);
    } catch (err) {
      setError(err.message || t("errors.generic"));
    } finally {
      setBusy("");
    }
  };

  const until = jobStatus?.scanExpiresAt
    ? new Date(jobStatus.scanExpiresAt).toLocaleTimeString(lang === "en" ? "en-IN" : `${lang}-IN`, { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="pf-after">
      {failed ? <div className="pf-alert info" role="status">{failureText(t, jobStatus || {})}</div> : null}
      {!failed && jobStatus?.refundStatus ? (
        <div className="pf-alert info" role="status">{t(`refund.status.${jobStatus.refundStatus}`)}</div>
      ) : null}
      {issue === "OPEN" ? <div className="pf-alert info" role="status">{t("issue.open")}</div> : null}
      {issue === "REJECTED" ? <div className="pf-alert info" role="status">{t("issue.rejected")}</div> : null}

      {isScan && !failed ? (
        jobStatus?.scanReady ? (
          <div className="pf-scan-ready">
            <button type="button" className="pf-btn primary" onClick={openScan} disabled={busy === "scan"}>
              <MdDownload size={18} aria-hidden="true" /> {t("scan.download")}
            </button>
            {until ? <p className="pf-otp-expiry">{t("scan.until", { time: until })}</p> : null}
          </div>
        ) : ["PRINTING", "PRINTED"].includes(status) ? (
          <p className="pf-otp-expiry">{t("scan.wait")}</p>
        ) : null
      ) : null}
      {jobStatus?.receiptAvailable ? (
        <button type="button" className="pf-btn ghost" onClick={receipt} disabled={busy === "receipt"}>
          <MdReceiptLong size={18} aria-hidden="true" /> {busy === "receipt" ? t("receipt.loading") : t("receipt.download")}
        </button>
      ) : null}
      {error ? <div className="pf-alert error" role="alert">⚠ {error}</div> : null}

      {ref ? <p className="pf-report-ref">{t("issue.ref")} <strong>{ref}</strong> · {t("issue.refHint")}</p> : null}

      {canReportIssue && !reporting ? (
        <button type="button" className="pf-link-btn pf-report-link" onClick={() => setReporting(true)}>
          {status === "PRINTED" ? t("issue.buttonPrinted") : t("issue.button")}
        </button>
      ) : null}
      {reporting ? (
        <ReportIssue jobId={jobId} refCode={ref} onClose={() => setReporting(false)} onReported={(r) => setIssueStatus(r.issueStatus)} />
      ) : null}
      {!paidOnline && !failed ? (
        <ReportProblem machineId={machineId} jobId={jobId} defaultCategory="PRINT_QUALITY" />
      ) : null}
    </div>
  );
}
