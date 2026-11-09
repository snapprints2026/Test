// hooks/usePrintJob.js
// The order flow: choose service & options → create the order → pay (or staff
// code) → collect.
//   PRINT  upload a file          FORM  pick a blank government form
//   COPY   photocopy at machine    SCAN  scan at machine, download the PDF
//   KIOSK (Module 1): after payment the customer gets an OTP to type at the machine.
//   SHOP  (Module 2): the shop / counter computer does it; the customer gets a
//                     short pickup code and live status.
// All backend calls go through src/api (the login token is attached there).
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import * as jobApi from "../../../api/job.api";
import * as paymentApi from "../../../api/payment.api";
import { calculatePrice } from "../../../utils/pricing";
import {
  ALLOWED_EXTENSIONS,
  MAX_FILE_SIZE,
  MAX_FILE_SIZE_LABEL,
  JOB_STATUS_POLL_MS,
} from "../../../config";

const DEFAULT_OPTIONS = { color: "bw", copies: 1, printSide: "single", paperSize: "A4", pages: 1 };
// Kiosk printers are A4 only (the live app hid A3). Shops show what their printers support.
const KIOSK_SIZES = ["A4"];
const FINAL_STATUSES = ["PRINTED", "FAILED", "EXPIRED"];

/* Which options this machine offers. Kiosks: B&W / colour, both sides, A4. Shops: what their printers can do. */
export function allowedOptions(capabilities, color, service = "PRINT") {
  if (service === "SCAN") return { colors: ["bw", "color"], duplex: false, paperSizes: ["A4"] };
  if (!capabilities) {
    return { colors: ["bw", "color"], duplex: true, paperSizes: KIOSK_SIZES };
  }
  const colors = ["bw", "color"].filter((c) => capabilities[c]?.available);
  const cap = capabilities[color] || {};
  return {
    colors,
    duplex: !!cap.duplex,
    paperSizes: cap.paperSizes && cap.paperSizes.length ? cap.paperSizes : ["A4"],
  };
}

export function usePrintJob({ machineId, machineStatus, capabilities, priceTable, billingMode, privacy, t, lang }) {
  const [service, setServiceState] = useState("PRINT");
  // Print options
  const [color, setColor] = useState(DEFAULT_OPTIONS.color);
  const [copies, setCopies] = useState(DEFAULT_OPTIONS.copies);
  const [printSide, setPrintSide] = useState(DEFAULT_OPTIONS.printSide);
  const [paperSize, setPaperSize] = useState(DEFAULT_OPTIONS.paperSize);
  const [pages, setPages] = useState(DEFAULT_OPTIONS.pages); // COPY / SCAN
  const [file, setFile] = useState(null);
  const [selectedForm, setSelectedForm] = useState(null);
  const [consent, setConsent] = useState(false);

  // Job state
  const [jobId, setJobId] = useState(null);
  const [summary, setSummary] = useState(null);
  const [paid, setPaid] = useState(null);        // { module, jobType, billing, otp?, qrToken?, orderCode? }
  const [jobStatus, setJobStatus] = useState(null); // latest /job-status answer after payment

  // UI state
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [paying, setPaying] = useState(false);
  const [fileError, setFileError] = useState("");
  const [jobError, setJobError] = useState("");
  const [jobSuccess, setJobSuccess] = useState("");

  const isDepartment = billingMode === "DEPARTMENT";

  const options = useMemo(
    () => ({ color, copies, paperSize, printSide, ...(service === "COPY" || service === "SCAN" ? { pages } : {}) }),
    [color, copies, paperSize, printSide, pages, service]
  );
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const allowed = useMemo(() => allowedOptions(capabilities, color, service), [capabilities, color, service]);

  /* ── Keep the chosen options possible on this machine (shops) ── */
  useEffect(() => {
    if (paid) return;
    if (allowed.colors.length && !allowed.colors.includes(color)) setColor(allowed.colors[0]);
    if (!allowed.duplex && printSide === "duplex") setPrintSide("single");
    if (!allowed.paperSizes.includes(paperSize)) setPaperSize(allowed.paperSizes[0]);
  }, [allowed, color, printSide, paperSize, paid]);

  /* ── Reset ── */
  const resetJob = useCallback(() => {
    setJobId(null);
    setSummary(null);
    setFile(null);
    setSelectedForm(null);
    setPaid(null);
    setJobStatus(null);
    setJobError("");
    setJobSuccess("");
    setColor(DEFAULT_OPTIONS.color);
    setCopies(DEFAULT_OPTIONS.copies);
    setPrintSide(DEFAULT_OPTIONS.printSide);
    setPaperSize(DEFAULT_OPTIONS.paperSize);
    setPages(DEFAULT_OPTIONS.pages);
  }, []);

  const setService = useCallback((s) => {
    setServiceState(s);
    setJobError("");
    setFileError("");
    if (s === "SCAN") { setCopies(1); setPrintSide("single"); }
  }, []);

  /* ── Pick a form → its default options ── */
  const chooseForm = useCallback((form) => {
    setSelectedForm(form);
    setJobError("");
    if (form) {
      setColor(form.color || "bw");
      setCopies(form.defaultCopies || 1);
      setPrintSide(form.printSide || "single");
      setPaperSize(form.paperSize || "A4");
    }
  }, []);

  /* ── A file made on the phone (card photos laid out on A4) — or null to clear ── */
  const setGeneratedFile = useCallback((f) => {
    setFileError("");
    setJobError("");
    if (f && f.size > MAX_FILE_SIZE) {
      setFileError(t("errors.fileSize", { size: MAX_FILE_SIZE_LABEL }));
      return;
    }
    setFile(f || null);
  }, [t]);

  /* ── File picker ── */
  const handleFileChange = (e) => {
    setFileError("");
    setJobError("");

    const selected = e.target.files[0];
    if (!selected) return;

    const extension = selected.name.split(".").pop().toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      setFileError(t("errors.fileType"));
      return;
    }
    if (selected.size > MAX_FILE_SIZE) {
      setFileError(t("errors.fileSize", { size: MAX_FILE_SIZE_LABEL }));
      return;
    }
    setFile(selected);
  };

  /* ── Price before the order exists (form / photocopy / scan) ── */
  const preview = useMemo(() => {
    const p = service === "FORM" ? selectedForm?.pages || 0 : service === "PRINT" ? 0 : pages;
    if (!p) return null;
    return calculatePrice({ pages: p, copies, color, printSide, paperSize, jobType: service }, priceTable);
  }, [service, selectedForm, pages, copies, color, printSide, paperSize, priceTable]);

  /* ── Instant price preview once the order exists (backend amount is what's charged) ── */
  const localSummary = useMemo(() => {
    if (!summary) return null;
    const jobType = summary.jobType || service;
    const p = jobType === "COPY" || jobType === "SCAN" ? pages : summary.pages || summary.totalPages || 0;
    const price = calculatePrice({ pages: p, copies, color, printSide, paperSize, jobType }, priceTable);
    return { ...summary, jobType, pages: p, color, copies, printSide, paperSize, rate: price.rate, units: price.units, totalAmount: price.total };
  }, [summary, service, pages, copies, color, printSide, paperSize, priceTable]);

  /* ── Summary after the order is created ── */
  const fetchSummary = useCallback(async (id) => {
    try {
      setSummary(await jobApi.getJobSummary(id));
    } catch (err) {
      setJobError(err.message || t("errors.price"));
    }
  }, [t]);

  /* ── Save option changes to the backend (debounced) ──
     Paused while payment is in progress — a late PATCH would reset the
     order to CREATED and break the payment. */
  useEffect(() => {
    if (!jobId || paid || paying) return;
    const timer = setTimeout(() => {
      jobApi.updateJob(jobId, options).catch((err) => {
        if (err.status === 400) setJobError(err.message);
      });
    }, 600);
    return () => clearTimeout(timer);
  }, [jobId, paid, paying, options]);

  const consentPayload = () => ({ accepted: true, version: privacy?.version, language: lang });

  /* ── STEP 1 — Create the order (upload / form / photocopy / scan) ── */
  const handleCreateJob = async () => {
    setJobError("");
    setJobSuccess("");

    if (machineStatus?.is_print_locked && service !== "SCAN") {
      setJobError(t("errors.outOfPaper"));
      return;
    }
    if (privacy?.required !== false && !consent) {
      setJobError(t("errors.consent"));
      return;
    }
    if (service === "PRINT" && (!machineId || !file)) {
      setJobError(t("errors.selectFile"));
      return;
    }
    if (service === "FORM" && !selectedForm) {
      setJobError(t("errors.chooseForm"));
      return;
    }

    try {
      setUploading(true);
      setUploadProgress(0);
      let data;
      if (service === "PRINT") {
        data = await jobApi.uploadJob({ file, machineId, ...options, consent: consentPayload(), onProgress: setUploadProgress });
      } else if (service === "FORM") {
        data = await jobApi.createFormJob({
          machineId, formTemplateId: selectedForm.id, copies, color, consent: consentPayload(),
        });
      } else {
        data = await jobApi.createServiceJob({ machineId, jobType: service, ...options, consent: consentPayload() });
      }
      setJobId(data.jobId); // move to step 2 immediately
      setJobSuccess(t("success.created"));
      fetchSummary(data.jobId); // price loads in the background
    } catch (err) {
      setJobError(err.message || t("errors.upload"));
    } finally {
      setUploading(false);
    }
  };

  /* ── After the payment (or staff code) is confirmed ── */
  const handlePaid = useCallback((result) => {
    setPaid({
      module: result.module || "KIOSK",
      jobType: result.jobType || "PRINT",
      billing: result.billing || "CUSTOMER",
      otp: result.otp || null,
      qrToken: result.qrToken || null,
      orderCode: result.orderCode || null,
      refCode: result.refCode || null,           // "SP-7KQ2MX" — what support asks for
      otpExpiresAt: result.otpExpiresAt || null,
    });
    setJobStatus({
      status: result.status || "PAID", module: result.module, orderCode: result.orderCode, jobType: result.jobType,
      billing: result.billing || "CUSTOMER", refCode: result.refCode || null,
    });
    setJobSuccess(
      result.billing === "DEPARTMENT" ? t("success.dept")
        : result.module === "SHOP" ? t("success.shop") : t("success.kiosk")
    );
  }, [t]);

  /* ── STEP 2 — Payment ── */
  const startPayment = async () => {
    setJobError("");
    setJobSuccess("");

    try {
      setPaying(true);

      // Save the latest options FIRST, then create the order (order matters:
      // the update resets the job, so it must finish before payment starts).
      await jobApi.updateJob(jobId, optionsRef.current);
      const data = await paymentApi.createPayment(jobId);

      if (data.free) {          // approved rate is ₹0 — nothing to pay
        handlePaid(data);
        setPaying(false);
        return;
      }

      if (data.mock) {
        // Backend runs with PAYMENT_MODE=mock (local testing) — no Razorpay window.
        const ok = window.confirm(t("pay.testMode", { amount: (data.amount / 100).toFixed(2) }));
        if (!ok) {
          setPaying(false);
          return;
        }
        handlePaid(await paymentApi.mockPay(data.orderId));
        setPaying(false);
        return;
      }

      if (!window.Razorpay) {
        setJobError(t("errors.paymentLoad"));
        setPaying(false);
        return;
      }

      const rzp = new window.Razorpay({
        key: data.key,
        amount: data.amount,
        currency: "INR",
        order_id: data.orderId,
        handler: async (response) => {
          try {
            handlePaid(await paymentApi.verifyPayment(response));
          } catch (err) {
            setJobError(`${err.message ? `${err.message}. ` : ""}${t("errors.verify")}`);
          } finally {
            setPaying(false);
          }
        },
        modal: { ondismiss: () => setPaying(false) },
        theme: { color: "#1A73E8" },
      });
      rzp.open();
    } catch (err) {
      setJobError(err.message || t("errors.payment"));
      setPaying(false);
    }
  };

  /* ── STEP 2 (department-billed machines) — staff code ── */
  const submitStaffCode = async (pin) => {
    setJobError("");
    setJobSuccess("");
    if (!pin) { setJobError(t("staff.required")); return; }
    try {
      setPaying(true);
      await jobApi.updateJob(jobId, optionsRef.current);
      handlePaid(await jobApi.submitBilled(jobId, pin));
    } catch (err) {
      setJobError(err.message || t("errors.generic"));
    } finally {
      setPaying(false);
    }
  };

  /* ── STEP 3 — Follow the order until it's done ── */
  useEffect(() => {
    if (!jobId || !paid) return;

    const interval = setInterval(async () => {
      try {
        const st = await jobApi.getJobStatus(jobId);
        setJobStatus(st);
        if (!FINAL_STATUSES.includes(st.status)) return;

        if (st.status === "PRINTED") {
          // Scans: keep polling until the download link shows up
          if (st.jobType === "SCAN" && !st.scanReady) return;
          clearInterval(interval);
        } else {
          // FAILED / EXPIRED: the refund message is shown under the order (AfterActions).
          // Keep polling until the refund has started, then stop.
          setJobSuccess("");
          setJobError(paid.billing === "DEPARTMENT" ? t("fail.dept") : "");
          const online = paid.billing !== "DEPARTMENT" && !!st.refCode;
          if (!online || (st.refundStatus && st.refundStatus !== "PROCESSING")) clearInterval(interval);
        }
      } catch {
        // temporary network issue — keep polling
      }
    }, JOB_STATUS_POLL_MS);

    return () => clearInterval(interval);
  }, [jobId, paid, t]);

  return {
    service, setService,
    // Options
    color, setColor,
    copies, setCopies,
    printSide, setPrintSide,
    paperSize, setPaperSize,
    pages, setPages,
    allowed,
    file, handleFileChange, setGeneratedFile,
    selectedForm, chooseForm,
    consent, setConsent,
    preview,

    // Job
    jobId,
    summary: localSummary,
    paid,
    otp: paid?.otp || null,
    qrToken: paid?.qrToken || null,
    jobStatus,
    isDepartment,

    // Actions
    handleCreateJob,
    startPayment,
    submitStaffCode,
    resetJob,

    // UI
    uploading,
    uploadProgress,
    paying,
    fileError,
    jobError,
    jobSuccess,
    clearJobError: () => setJobError(""),
    clearJobSuccess: () => setJobSuccess(""),
  };
}
