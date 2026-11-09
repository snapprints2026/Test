// steps/StepForms.jsx — the government form catalogue: tap a form, choose
// copies, pay, print. Nothing to upload.
import React, { useEffect, useMemo, useState } from "react";
import { MdDescription, MdSearch, MdCheckCircle } from "react-icons/md";
import { getForms } from "../../../api/machine.api";
import { useT } from "../../../i18n";
import { formatRupees } from "../../../utils/pricing";
import OptionsGrid from "./OptionsGrid";

const titleFor = (f, lang) => (lang === "hi" && f.title_hi) || (lang === "mr" && f.title_mr) || f.title;

export default function StepForms({ machineId, selectedForm, chooseForm, preview, optionProps, jobError, isLocked }) {
  const { t, lang } = useT();
  const [forms, setForms] = useState(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");

  useEffect(() => {
    let cancelled = false;
    getForms(machineId)
      .then((d) => !cancelled && setForms(d.forms || []))
      .catch((e) => !cancelled && setError(e.message || t("errors.generic")));
    return () => { cancelled = true; };
  }, [machineId, t]);

  const categories = useMemo(() => [...new Set((forms || []).map((f) => f.category).filter(Boolean))], [forms]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (forms || []).filter((f) =>
      (!category || f.category === category) &&
      (!q || [f.code, f.title, f.title_hi, f.title_mr, f.description].some((s) => s && s.toLowerCase().includes(q))));
  }, [forms, query, category]);

  if (selectedForm) {
    return (
      <div className="pf-step-enter">
        <p className="pf-section-title">{t("forms.selected")}</p>
        <div className="pf-form-card selected">
          <MdCheckCircle size={22} className="pf-form-icon" aria-hidden="true" />
          <div className="pf-form-main">
            <span className="pf-form-code">{selectedForm.code}</span>
            <span className="pf-form-title">{titleFor(selectedForm, lang)}</span>
            <span className="pf-form-meta">{t("forms.pages", { n: selectedForm.pages })}</span>
          </div>
          <button type="button" className="pf-link-btn" onClick={() => chooseForm(null)}>{t("forms.change")}</button>
        </div>
        {selectedForm.sourceUrl ? (
          <a className="pf-form-source" href={selectedForm.sourceUrl} target="_blank" rel="noopener noreferrer">{t("forms.source")} ↗</a>
        ) : null}
        <div className="pf-divider" />
        <OptionsGrid service="FORM" {...optionProps} />
        {preview ? (
          <div className="pf-preview-price" aria-live="polite">{t("summary.total")}: <strong>₹{formatRupees(preview.total)}</strong></div>
        ) : null}
        {jobError ? <div className="pf-alert error" role="alert">⚠ {jobError}</div> : null}
        {isLocked ? <div className="pf-alert warning" role="alert">⚠ {t("errors.outOfPaper")}</div> : null}
      </div>
    );
  }

  return (
    <div className="pf-step-enter">
      <div className="pf-form-search">
        <MdSearch size={18} aria-hidden="true" />
        <label htmlFor="pf-form-q" className="sr-only">{t("forms.search")}</label>
        <input id="pf-form-q" type="search" value={query} placeholder={t("forms.search")} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {categories.length > 1 ? (
        <div className="pf-chips" role="group" aria-label={t("forms.search")}>
          {["", ...categories].map((c) => (
            <button key={c || "all"} type="button" aria-pressed={category === c}
              className={`pf-chip ${category === c ? "active" : ""}`} onClick={() => setCategory(c)}>
              {c || t("forms.all")}
            </button>
          ))}
        </div>
      ) : null}
      {error ? <div className="pf-alert error" role="alert">⚠ {error}</div> : null}
      {!forms && !error ? <div className="pf-waiting"><span className="pf-spinner dark" /> {t("forms.loading")}</div> : null}
      {forms && !shown.length ? <p className="pf-empty">{t("forms.empty")}</p> : null}
      <ul className="pf-form-list">
        {shown.map((f) => (
          <li key={f.id}>
            <button type="button" className="pf-form-card" onClick={() => chooseForm(f)}>
              <MdDescription size={22} className="pf-form-icon" aria-hidden="true" />
              <span className="pf-form-main">
                <span className="pf-form-code">{f.code}</span>
                <span className="pf-form-title">{titleFor(f, lang)}</span>
                <span className="pf-form-meta">{[f.category, t("forms.pages", { n: f.pages })].filter(Boolean).join(" · ")}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {jobError ? <div className="pf-alert error" role="alert">⚠ {jobError}</div> : null}
    </div>
  );
}
