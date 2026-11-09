// steps/StepService.jsx — photocopy (COPY) or scan (SCAN) at the machine.
// The customer says how many pages; the price is shown before paying.
import React from "react";
import { MdContentCopy, MdDocumentScanner } from "react-icons/md";
import { useT } from "../../../i18n";
import { formatRupees } from "../../../utils/pricing";
import OptionsGrid from "./OptionsGrid";

export default function StepService({ service, optionProps, preview, jobError, isLocked }) {
  const { t } = useT();
  const Icon = service === "SCAN" ? MdDocumentScanner : MdContentCopy;
  return (
    <div className="pf-step-enter">
      <div className="pf-service-banner">
        <Icon size={28} aria-hidden="true" />
        <div>
          <strong>{t(`service.${service}`)}</strong>
          <span>{t(`service.hint.${service}`)}</span>
        </div>
      </div>
      <OptionsGrid service={service} {...optionProps} />
      {preview ? (
        <div className="pf-preview-price" aria-live="polite">
          {t("summary.total")}: <strong>₹{formatRupees(preview.total)}</strong>
          <span className="pf-preview-rate">
            {" "}({t("summary.perUnit", { rate: formatRupees(preview.rate), unit: t(service !== "SCAN" && optionProps.printSide === "duplex" ? "summary.unit.sheet" : "summary.unit.page") })})
          </span>
        </div>
      ) : null}
      {jobError ? <div className="pf-alert error" role="alert">⚠ {jobError}</div> : null}
      {isLocked && service === "COPY" ? <div className="pf-alert warning" role="alert">⚠ {t("errors.outOfPaper")}</div> : null}
    </div>
  );
}
