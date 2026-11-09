// src/api/job.api.js — print jobs (token is attached automatically by client.js)
import { apiRequest, apiBlob, ApiError } from "./client";

/* PUT the file straight to storage (Cloudflare R2, or the backend itself when
   testing locally) using the signed URL from the backend.
   XMLHttpRequest (not fetch) so we can show upload progress. */
function putToStorage(url, file, contentType, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType); // must match what the URL was signed for
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new ApiError(`Upload failed (${xhr.status}). Please try again.`, xhr.status));
    xhr.onerror = () => reject(new ApiError("Network error while uploading. Check your internet.", 0));
    xhr.send(file);
  });
}

/**
 * Upload in 3 steps — the file never passes through our server:
 *   1. backend creates the job and a signed upload URL
 *   2. browser PUTs the file to Cloudflare R2
 *   3. backend checks the file and counts pages
 * → { jobId, pages }
 */
export async function uploadJob({ file, machineId, color, copies, paperSize, printSide, consent, onProgress }) {
  const start = await apiRequest("/upload-url", {
    method: "POST",
    // source "CARD" = a page made on the phone from photos of a card (for reports)
    body: { fileName: file.name, fileSize: file.size, machineId, color, copies, paperSize, printSide, consent, source: file.snapSource || "UPLOAD" },
  });
  await putToStorage(start.uploadUrl, file, start.contentType, onProgress);
  return apiRequest(`/jobs/${encodeURIComponent(start.jobId)}/complete-upload`, { method: "POST" });
}

/** → { pages, totalPages, copies, printSide, color, units, rate, totalAmount } */
export const getJobSummary = (jobId) => apiRequest(`/job-summary/${encodeURIComponent(jobId)}`);

export const updateJob = (jobId, { color, copies, paperSize, printSide, pages }) =>
  apiRequest(`/job/${encodeURIComponent(jobId)}`, {
    method: "PATCH",
    body: { color, copies, paperSize, printSide, pages },
  });

/** Blank government form from the catalogue → { jobId, pages, form } */
export const createFormJob = ({ machineId, formTemplateId, copies, color, consent }) =>
  apiRequest("/form-jobs", { method: "POST", body: { machineId, formTemplateId, copies, color, consent } });

/** Photocopy / scan at the machine → { jobId, pages } */
export const createServiceJob = ({ machineId, jobType, pages, copies, color, printSide, paperSize, consent }) =>
  apiRequest("/service-jobs", {
    method: "POST",
    body: { machineId, jobType, pages, copies, color, printSide, paperSize, consent },
  });

/** Department-billed machines: staff code instead of payment → same answer as a payment */
export const submitBilled = (jobId, staffPin) =>
  apiRequest(`/jobs/${encodeURIComponent(jobId)}/submit-billed`, { method: "POST", body: { staffPin } });

/** SCAN orders → { url, expiresAt } */
export const getScanLink = (jobId) => apiRequest(`/jobs/${encodeURIComponent(jobId)}/scan`);

/** GST receipt PDF → downloads it (works for guests too: the token is attached when logged in) */
export async function downloadReceipt(jobId) {
  const blob = await apiBlob(`/jobs/${encodeURIComponent(jobId)}/receipt`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `receipt-${jobId.slice(-6)}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** → { status: "CREATED" | "PAYING" | "PAID" | "PRINTING" | "PRINTED" | "FAILED" | "EXPIRED",
 *      module, orderCode?, printerName?, queueAhead?, failReason? } */
/** "Didn't get your print?" → { issueStatus, refundStatus?, message, ticketNo? }
 *  reason: NOTHING_PRINTED | MISSING_PAGES | BAD_QUALITY | MACHINE_ERROR | OTHER */
export const reportIssue = (jobId, { reason, details }) =>
  apiRequest(`/jobs/${encodeURIComponent(jobId)}/report`, { method: "POST", body: { reason, details } });

export const getJobStatus = (jobId) => apiRequest(`/job-status/${encodeURIComponent(jobId)}`);
