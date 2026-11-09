// steps/StepOTP.jsx — Module 1 (kiosk): after payment, the OTP to type at the machine.
import React from "react";
import { useT } from "../../../i18n";
import AfterActions from "../parts/AfterActions";

export default function StepOTP({ machineId, jobId, otp, paid, pages, jobStatus, jobSuccess, jobError, onNewJob }) {
  const { t, lang } = useT();
  const jobType = paid?.jobType || "PRINT";
  const status = jobStatus?.status || "PAID";
  const done = status === "PRINTED" && (jobType !== "SCAN" || jobStatus?.scanReady);
  const failed = status === "FAILED" || status === "EXPIRED";
  const expiry = paid?.otpExpiresAt
    ? new Date(paid.otpExpiresAt).toLocaleTimeString(lang === "en" ? "en-IN" : `${lang}-IN`, { hour: "numeric", minute: "2-digit" })
    : null;

  return (
    <div className="pf-step-enter">
      <p className="pf-section-title">{t(jobType === "COPY" ? "otp.titleCOPY" : jobType === "SCAN" ? "otp.titleSCAN" : "otp.title")}</p>

      {jobSuccess && !failed && !done ? <div className="pf-alert success" role="status">✓ {jobSuccess}</div> : null}
      {jobError ? <div className="pf-alert error" role="alert">⚠ {jobError}</div> : null}

      {!done && !failed ? (
        <div className="pf-otp-box">
          <p className="pf-otp-label" id="pf-otp-label">{t("otp.label")}</p>
          <div className="pf-otp-code" aria-labelledby="pf-otp-label" aria-live="polite">{otp}</div>
          {jobType === "COPY" ? <p className="pf-otp-instr">{t("otp.copyInstr", { pages: pages || "" })}</p> : null}
          {jobType === "SCAN" ? <p className="pf-otp-instr">{t("otp.scanInstr", { pages: pages || "" })}</p> : null}
          <p className="pf-otp-expiry">
            {expiry ? `${t("otp.validUntil", { time: expiry })} ` : ""}{t("otp.keepOpen")}
          </p>
          <p className="pf-privacy-note">🔒 {t("otp.privacy")}</p>
        </div>
      ) : null}

      {!done && !failed ? (
        <div className="pf-waiting" role="status">
          <span className="pf-spinner dark" />
          {status === "PRINTED" && jobType === "SCAN" ? t("scan.wait") : t("otp.waiting")}
        </div>
      ) : null}

      {done ? <div className="pf-waiting is-done" role="status">✓ {t("otp.done")}</div> : null}

      <AfterActions machineId={machineId} jobId={jobId} jobStatus={jobStatus} failed={failed} refCode={paid?.refCode} />

      {done || failed ? (
        <button type="button" className="pf-btn primary" style={{ marginTop: 16 }} onClick={onNewJob}>{t("collect.another")}</button>
      ) : null}
    </div>
  );
}
