// steps/StepSummary.jsx — what will be done and what it costs, before paying.
import React, { useState } from "react";
import { ImCross } from "react-icons/im";
import { MdAttachFile, MdDescription, MdContentCopy, MdDocumentScanner } from "react-icons/md";
import { useT } from "../../../i18n";
import { formatRupees } from "../../../utils/pricing";
import OptionsGrid from "./OptionsGrid";

const ICON = { PRINT: MdAttachFile, FORM: MdDescription, COPY: MdContentCopy, SCAN: MdDocumentScanner };

export default function StepSummary({
  service,
  file,
  selectedForm,
  summary,
  optionProps,
  isDepartment,
  jobError,
  isLocked,
  onBack,
}) {
  const { t, lang } = useT();
  const [adjustOpen, setAdjustOpen] = useState(false);
  const jobType = summary?.jobType || service;
  const Icon = ICON[jobType] || MdAttachFile;
  const title =
    jobType === "PRINT" ? file?.name
      : jobType === "FORM" ? ((lang === "hi" && selectedForm?.title_hi) || (lang === "mr" && selectedForm?.title_mr) || summary?.formTitle || selectedForm?.title)
      : t(`service.${jobType}`);
  const unit = jobType !== "SCAN" && summary?.printSide === "duplex" ? "summary.unit.sheet" : "summary.unit.page";

  return (
    <div className="pf-step-enter">
      <div className="pf-file-info pf-summary-file-info">
        <span className="pf-summary-icon" aria-hidden="true"><Icon size={16} /></span>
        <span className="file-name">{title}</span>
        {onBack ? (
          <button onClick={onBack} title={t("summary.remove")} aria-label={t("summary.remove")} className="pf-remove-btn">
            <ImCross size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <p className="pf-section-title">{t("summary.title")}</p>

      {summary ? (
        <div className="pf-summary">
          <div className="pf-summary-header">
            <h3>{t("summary.details")}</h3>
          </div>
          <dl className="pf-summary-body">
            <div className="pf-summary-row"><dt className="key">{t("summary.service")}</dt><dd className="val">{t(`service.${jobType}`)}</dd></div>
            {jobType === "FORM" && summary.formCode ? (
              <div className="pf-summary-row"><dt className="key">{t("summary.form")}</dt><dd className="val">{summary.formCode}</dd></div>
            ) : null}
            <div className="pf-summary-row"><dt className="key">{t("summary.printType")}</dt><dd className="val">{t(summary.color === "color" ? "label.color" : "label.bw")}</dd></div>
            {jobType !== "SCAN" ? (
              <>
                <div className="pf-summary-row"><dt className="key">{t("summary.copies")}</dt><dd className="val">{summary.copies}</dd></div>
                <div className="pf-summary-row"><dt className="key">{t("summary.side")}</dt><dd className="val">{t(summary.printSide === "duplex" ? "label.duplex" : "label.single")}</dd></div>
                <div className="pf-summary-row"><dt className="key">{t("summary.paper")}</dt><dd className="val">{summary.paperSize}</dd></div>
              </>
            ) : null}
            <div className="pf-summary-row"><dt className="key">{t("summary.pages")}</dt><dd className="val">{summary.pages || "—"}</dd></div>
            <div className="pf-summary-row"><dt className="key">{t("summary.rate")}</dt><dd className="val">{t("summary.perUnit", { rate: formatRupees(summary.rate), unit: t(unit) })}</dd></div>
            <div className="pf-summary-total">
              <dt className="label">{t("summary.total")}</dt>
              <dd className="amount" aria-live="polite">₹{formatRupees(summary.totalAmount)}</dd>
            </div>
          </dl>
          {isDepartment ? <p className="pf-billed-note">{t("summary.billedNote")}</p> : null}
        </div>
      ) : (
        <div className="pf-waiting"><span className="pf-spinner dark" /></div>
      )}

      <button
        type="button"
        className={`pf-adjust-toggle ${adjustOpen ? "open" : ""}`}
        aria-expanded={adjustOpen}
        aria-controls="pf-adjust"
        onClick={() => setAdjustOpen((v) => !v)}
      >
        <span>✏ {t("summary.adjust")}</span>
        <span className="chevron" aria-hidden="true">▾</span>
      </button>

      <div id="pf-adjust" className={`pf-adjust-body ${adjustOpen ? "open" : ""}`}>
        <OptionsGrid service={jobType} {...optionProps} style={{ paddingBottom: 12 }} />
      </div>

      {jobError ? <div className="pf-alert error" role="alert" style={{ marginTop: 10 }}>⚠ {jobError}</div> : null}
      {isLocked && jobType !== "SCAN" ? (
        <div className="pf-alert warning" role="alert" style={{ marginTop: 10 }}>⚠ {t("errors.outOfPaperPay")}</div>
      ) : null}
    </div>
  );
}
