// parts/ConsentNotice.jsx — DPDP Act notice + "I agree" before any order.
// Short, plain-language, in the customer's language; the full policy is linked.
import React, { useState } from "react";
import { useT } from "../../../i18n";

export default function ConsentNotice({ privacy, strictPrivacy, service, checked, onChange }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  if (!privacy || privacy.required === false) return null;

  return (
    <div className="pf-consent">
      <label className="pf-consent-row" htmlFor="pf-consent">
        <input id="pf-consent" type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span>{t("consent.agree")}</span>
      </label>
      <button type="button" className="pf-consent-more" aria-expanded={open} aria-controls="pf-consent-details" onClick={() => setOpen((v) => !v)}>
        {t("consent.more")} {open ? "▴" : "▾"}
      </button>
      {open ? (
        <div id="pf-consent-details" className="pf-consent-details">
          <p className="pf-consent-title">{t("consent.title")}</p>
          <ul>
            <li>{t("consent.p1", { minutes: privacy.fileRetentionMinutes })}</li>
            <li>{t("consent.p2")}</li>
            {strictPrivacy ? <li>{t("consent.p3")}</li> : null}
            {service === "SCAN" ? <li>{t("consent.p4", { minutes: privacy.scanRetentionMinutes })}</li> : null}
            <li>{t("consent.p5")}</li>
          </ul>
          {privacy.grievance ? (
            <p className="pf-consent-small">
              {t("consent.grievance", { name: privacy.grievance.name, email: privacy.grievance.email })}
            </p>
          ) : null}
          {privacy.policyUrl ? (
            <a className="pf-consent-small" href={privacy.policyUrl} target="_blank" rel="noopener noreferrer">
              {t("consent.policy")} ↗
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
