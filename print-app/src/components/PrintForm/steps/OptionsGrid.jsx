// steps/OptionsGrid.jsx — print options, shared by every service.
// `allowed` comes from usePrintJob: on shop machines (Module 2) only what the
// shop's printers can do is offered (e.g. no colour if there's no colour copier).
// SCAN has no copies / sides; COPY and SCAN also ask how many pages.
import React from "react";
import { useT } from "../../../i18n";
import Counter from "../parts/Counter";

export default function OptionsGrid({
  service = "PRINT",
  color, setColor,
  copies, setCopies,
  printSide, setPrintSide,
  paperSize, setPaperSize,
  pages, setPages,
  allowed,
  style,
}) {
  const { t } = useT();
  const colors = allowed?.colors?.length ? allowed.colors : ["bw", "color"];
  const sizes = allowed?.paperSizes?.length ? allowed.paperSizes : ["A4", "A3"];
  const duplexOk = allowed ? allowed.duplex : true;
  const isScan = service === "SCAN";
  const asksPages = service === "COPY" || service === "SCAN";

  return (
    <div className="pf-grid" style={style}>
      {asksPages ? (
        <div className="pf-field pf-field-wide">
          <label id="pf-pages-label">{t("options.pages")}</label>
          <Counter id="pf-pages" label={t("options.pages")} value={pages} onChange={setPages} min={1} max={200} />
          <span className="pf-field-hint">{t(`options.pagesHint.${service}`)}</span>
        </div>
      ) : null}

      <div className="pf-field">
        <label htmlFor="pf-color">{t("options.printType")}</label>
        <select id="pf-color" value={color} onChange={(e) => setColor(e.target.value)}>
          <option value="bw" disabled={!colors.includes("bw")}>{t("options.bw")}</option>
          <option value="color" disabled={!colors.includes("color")}>
            {colors.includes("color") ? t("options.color") : t("options.colorNA")}
          </option>
        </select>
      </div>

      {!isScan ? (
        <div className="pf-field">
          <label id="pf-copies-label">{t("options.copies")}</label>
          <Counter id="pf-copies" label={t("options.copies")} value={copies} onChange={setCopies} min={1} max={50} />
        </div>
      ) : null}

      {!isScan ? (
        <div className="pf-field">
          <label htmlFor="pf-side">{t("options.side")}</label>
          <select id="pf-side" value={printSide} onChange={(e) => setPrintSide(e.target.value)}>
            <option value="single">{t("options.single")}</option>
            <option value="duplex" disabled={!duplexOk}>
              {duplexOk ? t("options.duplex") : t("options.duplexNA")}
            </option>
          </select>
        </div>
      ) : null}

      {!isScan ? (
        <div className="pf-field">
          <label htmlFor="pf-paper">{t("options.paper")}</label>
          <select id="pf-paper" value={paperSize} onChange={(e) => setPaperSize(e.target.value)}>
            {["A4", "A3"].map((s) => (
              <option key={s} value={s} disabled={!sizes.includes(s)}>
                {sizes.includes(s) ? s : t("options.notAvailable", { x: s })}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  );
}
