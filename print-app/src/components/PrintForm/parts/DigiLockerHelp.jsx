// parts/DigiLockerHelp.jsx — how to print documents that live in DigiLocker or
// Parivahan: download the PDF on the phone, then choose it here (same upload flow).
import React, { useState } from "react";
import { MdLock } from "react-icons/md";
import { useT } from "../../../i18n";

export default function DigiLockerHelp() {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="pf-digilocker">
      <button type="button" className="pf-digilocker-toggle" aria-expanded={open} aria-controls="pf-digilocker-body" onClick={() => setOpen((v) => !v)}>
        <MdLock size={16} aria-hidden="true" /> <span>{t("digilocker.title")}</span> <span aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>
      {open ? (
        <div id="pf-digilocker-body" className="pf-digilocker-body">
          <ol>
            <li>{t("digilocker.step1")}</li>
            <li>{t("digilocker.step2")}</li>
          </ol>
          <div className="pf-digilocker-links">
            <a href="https://www.digilocker.gov.in/" target="_blank" rel="noopener noreferrer">{t("digilocker.openDigilocker")} ↗</a>
            <a href="https://parivahan.gov.in/" target="_blank" rel="noopener noreferrer">{t("digilocker.openParivahan")} ↗</a>
          </div>
        </div>
      ) : null}
    </div>
  );
}
