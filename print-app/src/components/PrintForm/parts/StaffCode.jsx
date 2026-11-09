// parts/StaffCode.jsx — department-billed machines: staff confirm the order
// with the staff code instead of paying online.
import React, { useState } from "react";
import { useT } from "../../../i18n";

export default function StaffCode({ onSubmit, busy, disabled }) {
  const { t } = useT();
  const [pin, setPin] = useState("");
  return (
    <form
      className="pf-staff"
      onSubmit={(e) => { e.preventDefault(); onSubmit(pin); }}
    >
      <label htmlFor="pf-staff-pin" className="pf-staff-label">{t("staff.title")}</label>
      <p className="pf-staff-hint">{t("staff.hint")}</p>
      <div className="pf-staff-row">
        <input
          id="pf-staff-pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={8}
          value={pin}
          placeholder={t("staff.placeholder")}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
        />
        <button type="submit" className="pf-btn pay" disabled={busy || disabled || pin.length < 4}>
          {busy ? <><span className="pf-spinner" /> {t("staff.submitting")}</> : t("staff.submit")}
        </button>
      </div>
    </form>
  );
}
