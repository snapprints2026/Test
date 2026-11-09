// components/PrintForm/index.jsx
// Page shell: header (language + text size), login gate, step indicator, steps.
// Works for both modules — the machine's status says which one it runs:
//   KIOSK (Module 1): step 3 shows the OTP to type at the machine
//   SHOP  (Module 2): step 3 shows a pickup code and live progress
// and which services it offers: PRINT (upload) · FORM (catalogue) · COPY · SCAN.
// Department-billed machines (government counters) ask for the staff code
// instead of payment.
import React, { useEffect, useMemo, useState } from "react";
import { MdMenu } from "react-icons/md";
import "./PrintForm.css";

import { useT } from "../../i18n";
import { useMachineStatus } from "./hooks/useMachineStatus";
import { usePrintJob } from "./hooks/usePrintJob";
import { useAuth } from "./hooks/useAuth";
import { formatRupees } from "../../utils/pricing";

import A11yBar from "./parts/A11yBar";
import ServiceTabs, { tabsFor } from "./parts/ServiceTabs";
import ConsentNotice from "./parts/ConsentNotice";
import StaffCode from "./parts/StaffCode";
import StepUpload from "./steps/StepUpload";
import StepCard from "./steps/StepCard";
import StepForms from "./steps/StepForms";
import StepService from "./steps/StepService";
import StepSummary from "./steps/StepSummary";
import StepOTP from "./steps/StepOTP";
import StepCollect from "./steps/StepCollect";
import StepAuth from "./steps/StepAuth";
import HistoryPanel from "./steps/HistoryPanel";

function getCurrentStep(jobId, paid) {
  if (paid) return 3;
  if (jobId) return 2;
  return 1;
}

function Header({ auth, onMenu }) {
  const { t } = useT();
  return (
    <header className="pf-header">
      <div className="pf-header-icon">
        <img src="/Snapprints-icon.png" alt="" className="pf-logo-img" />
      </div>
      <div className="pf-header-text">
        <h1>Snap<span className="pf-logo-accent">Prints</span></h1>
        <p>{t("app.tagline")}</p>
      </div>
      {auth?.isAuthenticated ? (
        <button className="pf-menu-btn" onClick={onMenu} aria-label={t("menu.account")}>
          <MdMenu size={24} aria-hidden="true" />
        </button>
      ) : null}
    </header>
  );
}

export default function PrintForm() {
  const { t, lang, applyMachineDefault } = useT();
  const machine = useMachineStatus();
  const {
    machineId, machineStatus, isShop, capabilities, jobTypes, billingMode, priceTable, privacy,
    strictPrivacy, defaultLanguage, requireLogin, requireOnline, loading: machineLoading, error: machineError, isLocked, isOnline,
  } = machine;

  const auth = useAuth(t);
  const job = usePrintJob({ machineId, machineStatus, capabilities, priceTable, billingMode, privacy, t, lang });
  const {
    service, setService, file, handleFileChange, setGeneratedFile, selectedForm, chooseForm, consent, setConsent, preview,
    jobId, summary, paid, otp, jobStatus, isDepartment, handleCreateJob, startPayment, submitStaffCode,
    uploading, uploadProgress, paying, fileError, jobError, jobSuccess, resetJob,
  } = job;

  const [menuOpen, setMenuOpen] = useState(false);
  // Which tab is open. "CARD" (photo of a card) makes a normal PRINT job.
  const [tab, setTab] = useState("PRINT");
  const chooseTab = (next) => {
    if (next === tab) return;
    if ((next === "CARD") !== (tab === "CARD")) setGeneratedFile(null);
    setTab(next);
    setService(next === "CARD" ? "PRINT" : next);
  };
  const cardMode = tab === "CARD" && service === "PRINT";

  // The machine's language (e.g. Marathi at an RTO) until the customer picks one
  useEffect(() => { if (defaultLanguage) applyMachineDefault(defaultLanguage); }, [defaultLanguage, applyMachineDefault]);

  // First service this machine offers
  useEffect(() => {
    if (!jobId && !jobTypes.includes(service)) { setService(jobTypes[0]); setTab(jobTypes[0]); }
  }, [jobTypes, service, jobId, setService]);
  // After "start again" the tab follows the service
  useEffect(() => {
    if (tab !== service && !(tab === "CARD" && service === "PRINT")) setTab(service);
  }, [tab, service]);

  const optionProps = {
    color: job.color, setColor: job.setColor,
    copies: job.copies, setCopies: job.setCopies,
    printSide: job.printSide, setPrintSide: job.setPrintSide,
    paperSize: job.paperSize, setPaperSize: job.setPaperSize,
    pages: job.pages, setPages: job.setPages,
    allowed: job.allowed,
  };

  // Login screen only when THIS machine requires login (admin panel setting)
  const showLogin = requireLogin && !auth.isAuthenticated;
  const showSessionCheck = machineLoading || (requireLogin && auth.checkingSession);
  const currentStep = useMemo(() => getCurrentStep(jobId, paid), [jobId, paid]);
  const noPrinterNow = isShop && capabilities && !capabilities.bw?.online && !capabilities.color?.online;
  const lockedForService = isLocked && service !== "SCAN";
  // Don't take money for a machine that isn't connected (the backend checks this too).
  const printerOffline = requireOnline && !!machineStatus && !isOnline;

  const steps = [
    { id: 1, label: t(service === "PRINT" ? "steps.upload" : "steps.choose") },
    { id: 2, label: t(isDepartment ? "steps.confirm" : "steps.pay") },
    { id: 3, label: t("steps.collect") },
  ];

  const step1Ready =
    (service === "PRINT" && !!file) || (service === "FORM" && !!selectedForm) || service === "COPY" || service === "SCAN";

  let actionBar = null;
  if (currentStep === 1) {
    actionBar = (
      <button className="pf-btn primary" onClick={handleCreateJob} disabled={!step1Ready || uploading || lockedForService}>
        {uploading ? (
          <><span className="pf-spinner" /> {service === "PRINT"
            ? uploadProgress > 0 && uploadProgress < 100 ? t("upload.uploadingPct", { pct: uploadProgress }) : t("upload.uploading")
            : t("options.creating")}</>
        ) : service === "PRINT" ? t("upload.button")
          : <>{t("options.continue")}{preview ? ` · ₹${formatRupees(preview.total)}` : ""}</>}
      </button>
    );
  } else if (currentStep === 2 && isDepartment) {
    actionBar = <StaffCode onSubmit={submitStaffCode} busy={paying} disabled={(lockedForService) || !summary} />;
  } else if (currentStep === 2) {
    const free = summary && Number(summary.totalAmount) === 0;
    actionBar = (
      <button className="pf-btn pay" onClick={startPayment} disabled={paying || lockedForService || !summary || printerOffline}>
        {paying ? (
          <><span className="pf-spinner" /> {t("pay.opening")}</>
        ) : printerOffline ? t("pay.offline") : free ? t("pay.free") : (
          <>💳 {t("pay.button", { amount: summary ? formatRupees(summary.totalAmount) : "—", action: t(isShop ? "pay.print" : "pay.getOtp") })}</>
        )}
      </button>
    );
  }

  // ── No machine= param ──────────────────────────────────────────────────
  if (!machineId) {
    return (
      <div className="pf-page">
        <Header />
        <A11yBar />
        <main className="pf-card">
          <div className="pf-body" style={{ textAlign: "center", padding: "32px 20px" }}>
            <div style={{ fontSize: 44, marginBottom: 14 }} aria-hidden="true">🔗</div>
            <h2 className="pf-missing-title">{t("machine.missingTitle")}</h2>
            <p className="pf-missing-text">{t("machine.missingBody")}</p>
            <div className="pf-missing-example">
              <p>{t("machine.example")}</p>
              <code>https://print.snapprints.in/?machine=SPK1001</code>
            </div>
            <p className="pf-missing-note">{t("machine.qrNote")}</p>
          </div>
          <div className="pf-footer">{t("app.footer")}</div>
        </main>
      </div>
    );
  }

  const machineName = machineStatus?.organization_name || machineStatus?.name || t("status.shop");

  return (
    <div className="pf-page">
      <Header auth={auth} onMenu={() => setMenuOpen(true)} />
      <A11yBar />

      <main className="pf-card" id="main">
        {showSessionCheck ? (
          <div className="pf-body" style={{ textAlign: "center", padding: "32px 20px" }}>
            <span className="pf-spinner dark" role="status" aria-label="Loading" />
          </div>
        ) : showLogin ? (
          <div className="pf-body">
            <StepAuth {...auth} />
          </div>
        ) : (
          <>
            {/* STEP INDICATOR */}
            <ol className="pf-steps" aria-label={t("steps.label", { n: currentStep, label: steps[currentStep - 1].label })}>
              {steps.map((s) => (
                <li
                  key={s.id}
                  className={`pf-step ${currentStep === s.id ? "active" : currentStep > s.id ? "done" : ""}`}
                  aria-current={currentStep === s.id ? "step" : undefined}
                >
                  <div className="pf-step-num" aria-hidden="true">{currentStep > s.id ? "✓" : s.id}</div>
                  <span className="pf-step-label">{s.label}</span>
                </li>
              ))}
            </ol>

            {/* BODY */}
            <div className="pf-body">
              {machineError ? (
                <div className="pf-alert warning" role="alert">⚠ {machineError.key ? t(machineError.key) : machineError.text}</div>
              ) : null}

              {machineStatus ? (
                <>
                  <div className={`pf-status-bar ${isOnline && !noPrinterNow ? "" : "offline"}`} role="status">
                    <span className="dot" aria-hidden="true" />
                    {isLocked
                      ? t("status.outOfPaper")
                      : isShop
                      ? isOnline
                        ? noPrinterNow ? t("status.shopBusy", { name: machineName }) : t("status.shopOpen", { name: machineName })
                        : t("status.shopOffline", { name: machineName })
                      : isOnline
                      ? `${t("status.online")}${machineStatus.organization_name ? ` · ${machineStatus.organization_name}` : ""}`
                      : t("status.connecting")}
                  </div>
                  {isShop && currentStep < 3 && capabilities && service !== "SCAN" ? (
                    <p className="pf-shop-printers">
                      {[capabilities.bw?.available ? t("options.bw") : null, capabilities.color?.available ? t("options.color") : null]
                        .filter(Boolean).join(" + ") || t("shop.none")}
                      {(() => { const n = (capabilities.printers || []).filter((p) => p.online).length; return n ? ` · ${t("shop.ready", { n })}` : ""; })()}
                    </p>
                  ) : null}
                </>
              ) : null}

              {currentStep === 1 ? (
                <>
                  <ServiceTabs jobTypes={jobTypes} service={tabsFor(jobTypes).includes(tab) ? tab : service} setService={chooseTab} />
                  {cardMode ? (
                    <StepCard
                      file={file}
                      setGeneratedFile={setGeneratedFile}
                      {...optionProps}
                      isLocked={isLocked}
                      jobError={jobError}
                    />
                  ) : null}
                  {service === "PRINT" && !cardMode ? (
                    <StepUpload
                      showDigiLocker={machineStatus?.segment === "GOVERNMENT" || machineStatus?.segment === "PSU"}
                      file={file}
                      handleFileChange={handleFileChange}
                      fileError={fileError}
                      {...optionProps}
                      isLocked={isLocked}
                      jobError={jobError}
                    />
                  ) : null}
                  {service === "FORM" ? (
                    <StepForms machineId={machineId} selectedForm={selectedForm} chooseForm={chooseForm}
                      preview={preview} optionProps={optionProps} jobError={jobError} isLocked={isLocked} />
                  ) : null}
                  {service === "COPY" || service === "SCAN" ? (
                    <StepService service={service} optionProps={optionProps} preview={preview} jobError={jobError} isLocked={isLocked} />
                  ) : null}
                  {step1Ready ? (
                    <ConsentNotice privacy={privacy} strictPrivacy={strictPrivacy} service={service} checked={consent} onChange={setConsent} />
                  ) : null}
                </>
              ) : null}

              {currentStep === 2 ? (
                <StepSummary
                  service={service}
                  file={file}
                  selectedForm={selectedForm}
                  summary={summary}
                  optionProps={optionProps}
                  isDepartment={isDepartment}
                  jobError={jobError}
                  isLocked={isLocked}
                  onBack={resetJob}
                />
              ) : null}

              {currentStep === 3 && paid?.module === "SHOP" ? (
                <StepCollect machineId={machineId} jobId={jobId} paid={paid} jobStatus={jobStatus}
                  jobSuccess={jobSuccess} jobError={jobError} onNewJob={resetJob} />
              ) : null}

              {currentStep === 3 && paid?.module !== "SHOP" ? (
                <StepOTP machineId={machineId} jobId={jobId} otp={otp} paid={paid} pages={summary?.pages}
                  jobStatus={jobStatus} jobSuccess={jobSuccess} jobError={jobError} onNewJob={resetJob} />
              ) : null}
            </div>

            {actionBar !== null ? <div className="pf-action-bar">{actionBar}</div> : null}
          </>
        )}

        <div className="pf-footer">{t("app.footer")}</div>
      </main>

      <HistoryPanel
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        authUser={auth.authUser}
        onNameUpdated={auth.updateName}
        onLogout={auth.logout}
      />
    </div>
  );
}
