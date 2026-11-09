// parts/ServiceTabs.jsx — what the customer wants: print a file / photo of a card /
// form / photocopy / scan. Only the services this machine offers are shown.
// "CARD" is a second way to make a PRINT job (photos of a physical card), so it
// appears whenever the machine offers PRINT.
import React from "react";
import { MdPrint, MdDescription, MdContentCopy, MdDocumentScanner, MdBadge } from "react-icons/md";
import { useT } from "../../../i18n";

const ICONS = { PRINT: MdPrint, CARD: MdBadge, FORM: MdDescription, COPY: MdContentCopy, SCAN: MdDocumentScanner };

/* PRINT → PRINT + CARD */
export function tabsFor(jobTypes) {
  return (jobTypes || []).flatMap((jt) => (jt === "PRINT" ? ["PRINT", "CARD"] : [jt]));
}

export default function ServiceTabs({ jobTypes, service, setService }) {
  const { t } = useT();
  const tabs = tabsFor(jobTypes);
  if (tabs.length < 2) return null;
  return (
    <div className="pf-services">
      <p className="pf-section-title" id="pf-service-label">{t("service.label")}</p>
      <div className="pf-service-grid" role="radiogroup" aria-labelledby="pf-service-label">
        {tabs.map((type) => {
          const Icon = ICONS[type] || MdPrint;
          const active = service === type;
          return (
            <button
              key={type}
              type="button"
              role="radio"
              aria-checked={active}
              className={`pf-service ${active ? "active" : ""}`}
              onClick={() => setService(type)}
            >
              <Icon size={22} aria-hidden="true" />
              <span className="pf-service-name">{t(`service.${type}`)}</span>
              <span className="pf-service-hint">{t(`service.hint.${type}`)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
