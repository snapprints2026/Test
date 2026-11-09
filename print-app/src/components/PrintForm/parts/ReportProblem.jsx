// parts/ReportProblem.jsx — "Report a problem" → support ticket (no login needed)
import React, { useState } from "react";
import { reportProblem } from "../../../api/support.api";
import { useT } from "../../../i18n";

const CATS = ["PRINT_QUALITY", "PAYMENT", "MACHINE_DOWN", "PAPER_TONER", "OTHER"];

export default function ReportProblem({ machineId, jobId, defaultCategory = "OTHER" }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState(defaultCategory);
  const [message, setMessage] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const [error, setError] = useState("");

  if (done) return <div className="pf-alert success" role="status">✓ {t("report.sent", { ticket: done })}</div>;
  if (!open) {
    return (
      <button type="button" className="pf-link-btn pf-report-link" onClick={() => setOpen(true)}>
        {t("report.button")}
      </button>
    );
  }

  const send = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const r = await reportProblem({ machineId, jobId, category, message, phone: phone || undefined });
      setDone(r.ticketNo);
    } catch (err) {
      setError(err.message || t("errors.generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="pf-report" onSubmit={send}>
      <p className="pf-section-title">{t("report.title")}</p>
      <div className="pf-field">
        <label htmlFor="pf-report-cat">{t("report.category")}</label>
        <select id="pf-report-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATS.map((c) => <option key={c} value={c}>{t(`report.cat.${c}`)}</option>)}
        </select>
      </div>
      <div className="pf-field">
        <label htmlFor="pf-report-msg">{t("report.message")}</label>
        <textarea id="pf-report-msg" rows={3} required minLength={3} value={message} onChange={(e) => setMessage(e.target.value)} />
      </div>
      <div className="pf-field">
        <label htmlFor="pf-report-phone">{t("report.phone")}</label>
        <input id="pf-report-phone" type="tel" inputMode="numeric" maxLength={10} value={phone}
          onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} />
      </div>
      {error ? <div className="pf-alert error" role="alert">⚠ {error}</div> : null}
      <div className="pf-report-actions">
        <button type="button" className="pf-btn ghost" onClick={() => setOpen(false)}>{t("report.cancel")}</button>
        <button type="submit" className="pf-btn primary" disabled={busy || message.trim().length < 3}>
          {busy ? t("report.sending") : t("report.send")}
        </button>
      </div>
    </form>
  );
}
