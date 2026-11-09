// HistoryPanel.jsx
import React, { useEffect, useState, useCallback } from "react";
import {
  MdClose, MdEdit, MdCheck, MdPictureAsPdf, MdImage,
  MdDescription, MdInsertDriveFile, MdHistoryToggleOff, MdPrint,
} from "react-icons/md";

import * as customerApi from "../../../api/customer.api";
import { useT } from "../../../i18n";
import ReportIssue from "../parts/ReportIssue";

const REPORT_WINDOW_MS = 48 * 60 * 60 * 1000; // same as the backend's ISSUE_REPORT_WINDOW_HOURS

/* "Report a problem" only for orders paid online whose OTP was used (or that
   printed), not refunded or reported yet, within the reporting window. */
function canReportJob(job) {
  return (
    Number(job.is_paid) === 1 &&
    (job.billing || "CUSTOMER") === "CUSTOMER" && Number(job.amount) > 0 &&
    (job.status === "PRINTING" || job.status === "PRINTED") &&
    !job.refund_status && !job.issue_status &&
    Date.now() - new Date(job.created_at).getTime() < REPORT_WINDOW_MS
  );
}

const PAYMENT_METHOD_LABELS = {
  upi: "UPI",
  card: "Card",
  netbanking: "Net Banking",
  wallet: "Wallet",
  emi: "EMI",
};

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) +
    " · " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function getInitials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  const initials = parts.length > 1
    ? parts[0][0] + parts[parts.length - 1][0]
    : parts[0].slice(0, 2);
  return initials.toUpperCase();
}

function FileIcon({ fileName }) {
  const ext = (fileName || "").split(".").pop().toLowerCase();
  if (ext === "pdf") return <MdPictureAsPdf size={19} />;
  if (["jpg", "jpeg", "png", "gif", "bmp", "webp", "tif", "tiff"].includes(ext)) return <MdImage size={19} />;
  if (["doc", "docx", "txt"].includes(ext)) return <MdDescription size={19} />;
  return <MdInsertDriveFile size={19} />;
}

function HistorySkeleton() {
  return (
    <div className="pf-history-skeleton">
      <div className="pf-skel-row" />
      <div className="pf-skel-row" />
      <div className="pf-skel-row" />
    </div>
  );
}

export default function HistoryPanel({ open, onClose, authUser, onNameUpdated, onLogout }) {
  const { t } = useT();
  const [jobs, setJobs] = useState([]);
  const [reportingJobId, setReportingJobId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(authUser?.user?.name || "");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState("");

  const token = authUser?.token;
  const currentName = authUser?.user?.name || "";

  const fetchHistory = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const data = await customerApi.getHistory();
      setJobs(data.jobs || []);
    } catch (err) {
      setError(err.message || t("history.loadError"));
    } finally {
      setLoading(false);
    }
  }, [token, t]);

  useEffect(() => {
    if (open) {
      setNameDraft(currentName);
      setEditingName(false);
      setNameError("");
      fetchHistory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fetchHistory]);

  // Close on Escape — small touch, matters a lot on desktop
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const saveName = async () => {
    if (!nameDraft.trim()) {
      setNameError(t("history.nameEmpty"));
      return;
    }
    setNameError("");
    setSavingName(true);
    try {
      const data = await customerApi.updateName(nameDraft.trim());
      onNameUpdated?.(data.name);
      setEditingName(false);
    } catch (err) {
      setNameError(err.message || "Could not update name");
    } finally {
      setSavingName(false);
    }
  };

  const cancelEditName = () => {
    setNameDraft(currentName);
    setNameError("");
    setEditingName(false);
  };

  const deleteAccount = async () => {
    if (!window.confirm(t("history.deleteConfirm"))) return;
    try {
      await customerApi.deleteAccount();
      window.alert(t("history.deleted"));
      onLogout?.();
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };

  if (!open) return null;

  return (
    <div className="pf-drawer-overlay" onClick={onClose}>
      <div className="pf-drawer" role="dialog" aria-modal="true" aria-labelledby="pf-drawer-title" onClick={(e) => e.stopPropagation()}>
        <div className="pf-drawer-header">
          <h3 id="pf-drawer-title">{t("history.title")}</h3>
          <button className="pf-drawer-close" onClick={onClose} aria-label={t("history.close")}>
            <MdClose size={18} />
          </button>
        </div>

        <div className="pf-drawer-profile">
          <div className="pf-drawer-avatar">{getInitials(currentName)}</div>

          <div className="pf-drawer-profile-info">
            {!editingName ? (
              <div className="pf-drawer-profile-row">
                <span className="pf-drawer-name">{currentName}</span>
                <button className="pf-icon-btn" onClick={() => setEditingName(true)} aria-label={t("history.editName")}>
                  <MdEdit size={16} />
                </button>
              </div>
            ) : (
              <div className="pf-drawer-profile-row">
                <input
                  type="text"
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  className="pf-drawer-name-input"
                  aria-label={t("history.editName")}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveName();
                    if (e.key === "Escape") cancelEditName();
                  }}
                />
                <button className="pf-icon-btn" onClick={saveName} disabled={savingName} aria-label={t("history.saveName")}>
                  <MdCheck size={18} />
                </button>
              </div>
            )}
            <span className="pf-drawer-mobile">+91 {authUser?.mobile}</span>
            {nameError ? <div className="pf-alert error" style={{ marginTop: 8 }}>⚠ {nameError}</div> : null}
          </div>
        </div>

        <div className="pf-drawer-body">
          <p className="pf-section-title">
            {t("history.list")}
            {jobs.length > 0 ? <span className="pf-history-count">{jobs.length}</span> : null}
          </p>

          {loading ? (
            <HistorySkeleton />
          ) : error ? (
            <div className="pf-alert error">⚠ {error}</div>
          ) : jobs.length === 0 ? (
            <div className="pf-drawer-empty">
              <div className="pf-drawer-empty-icon">
                <MdHistoryToggleOff size={26} />
              </div>
              <span>{t("history.empty")}</span>
            </div>
          ) : (
            <div className="pf-drawer-history">
              {jobs.map((job) => {
                const machineLabel = job.machine_name || job.machine_id;
                const locationLabel = job.location_name
                  ? `${job.location_name}${job.city ? `, ${job.city}` : ""}`
                  : null;
                const paymentLabel = job.payment_method
                  ? PAYMENT_METHOD_LABELS[job.payment_method] || job.payment_method
                  : null;

                return (
                  <div key={job.job_id} className="pf-history-item">
                    <div className="pf-history-icon">
                      <FileIcon fileName={job.file_name} aria-hidden="true" />
                    </div>
                    <div className="pf-history-main">
                      <div className="pf-history-top">
                        <span className="pf-history-file">
                          {job.job_type && job.job_type !== "PRINT" ? `${t(`service.${job.job_type}`)} · ` : ""}{job.file_name}
                        </span>
                        <span className={`pf-history-status status-${job.status.toLowerCase()}`}>
                          {t(`jobStatus.${job.status}`)}
                        </span>
                      </div>

                      {machineLabel && (
                        <div
                          className="pf-history-machine"
                          style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--ink-2, #8a8f98)", marginTop: 2 }}
                        >
                          <MdPrint size={13} />
                          <span>
                            {machineLabel}
                            {locationLabel ? ` · ${locationLabel}` : ""}
                          </span>
                        </div>
                      )}

                      <div className="pf-history-bottom">
                        <span>
                          {formatDate(job.created_at)}
                          {paymentLabel ? ` · ${t("history.paidVia", { method: paymentLabel })}` : ""}
                        </span>
                        <span className="pf-history-amount">
                          {job.amount != null ? `₹${job.amount}` : "—"}
                        </span>
                      </div>

                      {job.refund_status || job.issue_status || job.ref_code ? (
                        <div className="pf-history-support">
                          {job.refund_status ? (
                            <span className={`pf-history-refund refund-${job.refund_status.toLowerCase()}`}>
                              {t(`refund.label.${job.refund_status}`)}
                              {job.refund_amount ? ` · ₹${Number(job.refund_amount)}` : ""}
                            </span>
                          ) : job.issue_status === "OPEN" || job.issue_status === "REJECTED" ? (
                            <span className="pf-history-refund">{t(`issue.label.${job.issue_status}`)}</span>
                          ) : null}
                          {job.ref_code ? <span className="pf-history-ref">{t("issue.ref")} {job.ref_code}</span> : null}
                        </div>
                      ) : null}

                      {canReportJob(job) && reportingJobId !== job.job_id ? (
                        <button type="button" className="pf-link-btn pf-report-link" onClick={() => setReportingJobId(job.job_id)}>
                          {t("report.button")}
                        </button>
                      ) : null}
                      {reportingJobId === job.job_id ? (
                        <ReportIssue
                          jobId={job.job_id}
                          refCode={job.ref_code}
                          onClose={() => { setReportingJobId(null); fetchHistory(); }}
                        />
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="pf-drawer-footer">
          {onLogout ? (
            <button type="button" className="pf-btn ghost" onClick={() => { onLogout(); onClose(); }}>{t("history.logout")}</button>
          ) : null}
          <button type="button" className="pf-link-btn pf-danger-link" onClick={deleteAccount}>{t("history.delete")}</button>
        </div>
      </div>
    </div>
  );
}