// steps/StepUpload.jsx
import React, { useEffect, useRef, useState } from "react";
import { MdAttachFile, MdCloudUpload, MdInsertDriveFile } from "react-icons/md";
import OptionsGrid from "./OptionsGrid";
import DigiLockerHelp from "../parts/DigiLockerHelp";
import { useT } from "../../../i18n";

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getExtension(file) {
  return file.name.split(".").pop().toLowerCase();
}

// Which files get a real rendered preview vs. just an icon fallback
function getPreviewType(file) {
  if (!file) return null;
  const ext = getExtension(file);

  if (ext === "pdf") return "pdf";
  if (["jpg", "jpeg", "png", "gif", "bmp", "webp", "tif", "tiff"].includes(ext)) return "image";
  if (ext === "txt") return "text";
  if (ext === "docx") return "docx";
  if (ext === "doc") return "doc";     // legacy binary — no client-side parser, fallback icon
  return "other";
}

const PREVIEWABLE_TYPES = ["pdf", "image", "text", "docx"];

// ---- Shared CDN script loader (works for pdf.js, mammoth, anything) ----
const scriptLoadPromises = {};
function loadScript(src, globalCheck) {
  if (globalCheck()) return Promise.resolve();
  if (scriptLoadPromises[src]) return scriptLoadPromises[src];

  scriptLoadPromises[src] = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });

  return scriptLoadPromises[src];
}

function loadPdfJs() {
  return loadScript(
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
    () => !!window.pdfjsLib
  ).then(() => {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    return window.pdfjsLib;
  });
}

function loadMammoth() {
  return loadScript(
    "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js",
    () => !!window.mammoth
  ).then(() => window.mammoth);
}

// ---- Unified preview component: image, pdf, txt, docx ----
function FilePreview({ file, type }) {
  const { t } = useT();
  const canvasRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [imageUrl, setImageUrl] = useState(null);

  const [pdfDoc, setPdfDoc] = useState(null);
  const [pageInfo, setPageInfo] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);

  const [textContent, setTextContent] = useState("");
  const [docxHtml, setDocxHtml] = useState("");

  // Reset on file/type change
  useEffect(() => {
    setLoading(true);
    setError(false);
    setImageUrl(null);
    setPdfDoc(null);
    setPageInfo(null);
    setCurrentPage(1);
    setTextContent("");
    setDocxHtml("");
  }, [file, type]);

  // ---- IMAGE ----
  useEffect(() => {
    if (type !== "image" || !file) return;
    const objectUrl = URL.createObjectURL(file);
    setImageUrl(objectUrl);
    setLoading(false);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file, type]);

  // ---- PDF: load document ----
  useEffect(() => {
    if (type !== "pdf" || !file) return;
    let cancelled = false;

    (async () => {
      try {
        const pdfjsLib = await loadPdfJs();
        if (cancelled) return;

        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        if (cancelled) return;

        setPdfDoc(pdf);
        setPageInfo({ total: pdf.numPages });
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          console.error("PDF preview failed:", err);
          setError(true);
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [file, type]);

  // ---- PDF: render current page ----
  useEffect(() => {
    if (type !== "pdf" || !pdfDoc || !canvasRef.current) return;
    let cancelled = false;

    (async () => {
      try {
        const page = await pdfDoc.getPage(currentPage);
        if (cancelled) return;

        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = canvasRef.current;
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({
          canvasContext: canvas.getContext("2d"),
          viewport,
        }).promise;
      } catch (err) {
        if (!cancelled) {
          console.error("PDF page render failed:", err);
          setError(true);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [type, pdfDoc, currentPage]);

  // ---- TXT ----
  useEffect(() => {
    if (type !== "text" || !file) return;
    let cancelled = false;

    (async () => {
      try {
        const raw = await file.text();
        if (cancelled) return;
        const truncated = raw.length > 4000 ? raw.slice(0, 4000) + "\n\n… (truncated)" : raw;
        setTextContent(truncated);
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          console.error("Text preview failed:", err);
          setError(true);
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [file, type]);

  // ---- DOCX ----
  useEffect(() => {
    if (type !== "docx" || !file) return;
    let cancelled = false;

    (async () => {
      try {
        const mammoth = await loadMammoth();
        if (cancelled) return;

        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer });
        if (cancelled) return;

        setDocxHtml(result.value);
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          console.error("DOCX preview failed:", err);
          setError(true);
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [file, type]);

  if (error) {
    return <MdInsertDriveFile size={60} color="#00C2FF" />;
  }

  if (loading) {
    return (
      <div className="pf-preview-loading">
        <span className="pf-spinner dark" />
        <span>{t("upload.loadingPreview")}</span>
      </div>
    );
  }

  return (
    <div className="pf-preview-wrap">
      {type === "image" && (
        <img src={imageUrl} alt={t("upload.preview")} className="pf-preview-img" />
      )}

      {type === "pdf" && (
        <canvas ref={canvasRef} className="pf-preview-canvas" role="img" aria-label={t("upload.preview")} />
      )}

      {type === "text" && (
        <pre className="pf-preview-text">{textContent}</pre>
      )}

      {type === "docx" && (
        <div
          className="pf-preview-docx"
          dangerouslySetInnerHTML={{ __html: docxHtml }}
        />
      )}

      {type === "pdf" && pageInfo?.total > 1 && (
        <div className="pf-pdf-nav">
          <button
            className="pf-pdf-nav-btn"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            aria-label={t("upload.prevPage")}
          >
            ‹
          </button>
          <span className="pf-pdf-nav-label">
            {t("upload.page", { n: currentPage, total: pageInfo.total })}
          </span>
          <button
            className="pf-pdf-nav-btn"
            onClick={() => setCurrentPage((p) => Math.min(pageInfo.total, p + 1))}
            disabled={currentPage === pageInfo.total}
            aria-label={t("upload.nextPage")}
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}

export default function StepUpload({
  showDigiLocker,
  file,
  handleFileChange,
  fileError,
  color, setColor,
  copies, setCopies,
  printSide, setPrintSide,
  paperSize, setPaperSize,
  allowed,
  isLocked,
  jobError,
}) {
  const { t } = useT();
  const previewType = getPreviewType(file);
  const hasPreview = PREVIEWABLE_TYPES.includes(previewType);

  return (
    <div className="pf-step-enter">

      <p className="pf-section-title">{t("upload.formats")}</p>

      <div className={`pf-upload-card ${file ? "has-file" : ""}`}>
        <div className={`pf-dropzone ${file ? "has-file" : ""}`}>
          <input
            type="file"
            accept=".pdf,.doc,.docx,.txt,.jpg,.jpeg,.png,.gif,.bmp,.webp,.tif,.tiff"
            onChange={handleFileChange}
            aria-label={t("upload.chooseLabel")}
          />
          {!file ? (
            <>
              <div className="pf-dropzone-icon" aria-hidden="true"><MdCloudUpload size={60} color="#1A73E8" /></div>
              <div className="pf-dropzone-text">{t("upload.choose")}</div>
              <div className="pf-dropzone-hint">{t("upload.deleteNote")}</div>
            </>
          ) : hasPreview ? (
            <FilePreview file={file} type={previewType} />
          ) : (
            <>
              <div className="pf-dropzone-icon"><MdInsertDriveFile size={60} color="#00C2FF" /></div>
              <div className="pf-dropzone-text">{t("upload.selected")}</div>
              <div className="pf-dropzone-hint">{t("upload.deleteNote")}</div>
            </>
          )}
        </div>

        {file ? (
          <div className="pf-file-info">
            <span style={{ color: "var(--lime)", display: "flex" }}>
              <MdAttachFile size={16} />
            </span>
            <span className="file-name">{file.name}</span>
            <span className="file-size">{formatBytes(file.size)}</span>
          </div>
        ) : null}
      </div>

      {fileError ? (
        <div className="pf-alert error" role="alert">⚠ {fileError}</div>
      ) : null}

      {!file && showDigiLocker ? <DigiLockerHelp /> : null}

      {file ? (
        <>
          <div className="pf-divider" />
          <p className="pf-section-title">{t("options.title")}</p>

          <OptionsGrid
            color={color} setColor={setColor}
            copies={copies} setCopies={setCopies}
            printSide={printSide} setPrintSide={setPrintSide}
            paperSize={paperSize} setPaperSize={setPaperSize}
            allowed={allowed}
          />
        </>
      ) : null}

      {jobError ? (
        <div className="pf-alert error" role="alert" style={{ marginTop: 10 }}>⚠ {jobError}</div>
      ) : null}

      {isLocked ? (
        <div className="pf-alert warning" role="alert" style={{ marginTop: 10 }}>
          ⚠ {t("errors.outOfPaper")}
        </div>
      ) : null}

    </div>
  );
}