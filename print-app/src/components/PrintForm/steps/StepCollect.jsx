// steps/StepCollect.jsx — Module 2 (shop / counter): after payment.
// No OTP: the computer prints automatically (PRINT / FORM) or the counter does
// it by hand (COPY / SCAN). The customer sees a short pickup code and live status.
import React from "react";
import { useT } from "../../../i18n";
import AfterActions from "../parts/AfterActions";

function stepIndex(status) {
  if (status === "PRINTED") return 2;
  if (status === "PRINTING") return 1;
  return 0;
}

export default function StepCollect({ machineId, jobId, paid, jobStatus, jobSuccess, jobError, onNewJob }) {
  const { t } = useT();
  const status = jobStatus?.status || "PAID";
  const code = jobStatus?.orderCode || paid?.orderCode;
  const jobType = jobStatus?.jobType || paid?.jobType || "PRINT";
  const manual = jobType === "COPY" || jobType === "SCAN";
  const failed = status === "FAILED" || status === "EXPIRED";
  const done = status === "PRINTED";
  const idx = stepIndex(status);
  const steps = [
    { key: "PAID", label: t(paid?.billing === "DEPARTMENT" ? "track.confirmed" : "track.paid") },
    { key: "PRINTING", label: t("track.printing") },
    { key: "PRINTED", label: t("track.ready") },
  ];

  let headline;
  if (manual) {
    headline = done
      ? t(jobType === "SCAN" ? "collect.scanDone" : "collect.copyDone")
      : status === "PRINTING" ? t("collect.working") : t(jobType === "SCAN" ? "collect.scanWait" : "collect.copyWait");
  } else {
    headline = t("collect.waiting");
    if (status === "PAID" && jobStatus?.queueAhead > 0) headline = t("collect.queue", { n: jobStatus.queueAhead });
    if (status === "PRINTING") headline = jobStatus?.printerName ? t("collect.printingOn", { printer: jobStatus.printerName }) : t("collect.printing");
    if (done) headline = t("collect.printed");
  }

  return (
    <div className="pf-step-enter">
      <p className="pf-section-title">{t("collect.title")}</p>

      {jobSuccess && !failed && !done ? <div className="pf-alert success" role="status">✓ {jobSuccess}</div> : null}
      {jobError ? <div className="pf-alert error" role="alert">⚠ {jobError}</div> : null}

      <div className="pf-otp-box">
        <p className="pf-otp-label" id="pf-code-label">{t("collect.code")}</p>
        <div className={`pf-otp-code pf-order-code ${failed ? "is-failed" : ""}`} aria-labelledby="pf-code-label">{code || "—"}</div>
      </div>

      {!failed ? (
        <ol className="pf-track" aria-label={t("track.label")}>
          {steps.map((s, i) => (
            <li key={s.key} className={`pf-track-step ${i < idx || done ? "done" : i === idx ? "active" : ""}`}
              aria-current={i === idx && !done ? "step" : undefined}>
              <span className="pf-track-dot" aria-hidden="true">{i < idx || done ? "✓" : i + 1}</span>
              <span className="pf-track-label">{s.label}</span>
            </li>
          ))}
        </ol>
      ) : null}

      {!failed ? (
        <div className={`pf-waiting ${done ? "is-done" : ""}`} role="status" aria-live="polite">
          {!done ? <span className="pf-spinner dark" /> : null}
          {headline}
        </div>
      ) : null}

      <AfterActions machineId={machineId} jobId={jobId} jobStatus={jobStatus} failed={failed} refCode={paid?.refCode} />

      {done || failed ? (
        <button type="button" className="pf-btn primary" style={{ marginTop: 16 }} onClick={onNewJob}>
          {t("collect.another")}
        </button>
      ) : (
        <p className="pf-otp-expiry" style={{ marginTop: 12 }}>{t("collect.closeNote")}</p>
      )}
    </div>
  );
}
