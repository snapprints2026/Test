// parts/A11yBar.jsx — language + text size (GIGW: content in the user's language,
// text resizable). Sits in the page header.
import React, { useEffect, useState } from "react";
import { LANGUAGES, useT } from "../../../i18n";

const SIZES = [
  { key: "sm", zoom: 0.92, label: "text.smaller", glyph: "A−" },
  { key: "md", zoom: 1, label: "text.normal", glyph: "A" },
  { key: "lg", zoom: 1.15, label: "text.larger", glyph: "A+" },
];
const SIZE_KEY = "snapprints_text_size";

export default function A11yBar() {
  const { lang, setLang, t } = useT();
  const [size, setSize] = useState(() => {
    try { return localStorage.getItem(SIZE_KEY) || "md"; } catch { return "md"; }
  });

  useEffect(() => {
    const s = SIZES.find((x) => x.key === size) || SIZES[1];
    document.documentElement.style.setProperty("--pf-zoom", String(s.zoom));
    try { localStorage.setItem(SIZE_KEY, s.key); } catch { /* private mode */ }
  }, [size]);

  return (
    <div className="pf-a11y" role="group" aria-label={`${t("lang.label")} / ${t("text.label")}`}>
      <div className="pf-lang" role="radiogroup" aria-label={t("lang.label")}>
        {LANGUAGES.map((l) => (
          <button
            key={l.code}
            type="button"
            role="radio"
            aria-checked={lang === l.code}
            lang={l.code}
            className={`pf-lang-btn ${lang === l.code ? "active" : ""}`}
            onClick={() => setLang(l.code)}
            title={l.label}
          >
            {l.label}
          </button>
        ))}
      </div>
      <div className="pf-textsize" role="radiogroup" aria-label={t("text.label")}>
        {SIZES.map((s) => (
          <button
            key={s.key}
            type="button"
            role="radio"
            aria-checked={size === s.key}
            aria-label={t(s.label)}
            title={t(s.label)}
            className={`pf-size-btn size-${s.key} ${size === s.key ? "active" : ""}`}
            onClick={() => setSize(s.key)}
          >
            {s.glyph}
          </button>
        ))}
      </div>
    </div>
  );
}
