// src/api/client.js
// One fetch wrapper for every backend call:
//  - prefixes API_BASE
//  - attaches "Authorization: Bearer <token>" automatically when logged in
//  - parses JSON and throws an Error with the backend's message on failure
//  - on 401 from an authenticated call, fires "snapprints:unauthorized"
//    so useAuth can log the user out (expired / invalid token)
import { API_BASE } from "../config";
import { getToken } from "../utils/authStorage";

export const UNAUTHORIZED_EVENT = "snapprints:unauthorized";

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

/**
 * @param {string} path      e.g. "/job-summary/JOB_123"
 * @param {object} options   { method, body (object → JSON), formData, auth (default true) }
 */
export async function apiRequest(path, { method = "GET", body, formData, auth = true } = {}) {
  const headers = {};
  const token = auth ? getToken() : null;
  if (token) headers.Authorization = `Bearer ${token}`;

  let payload;
  if (formData) {
    payload = formData; // browser sets the multipart boundary itself
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { method, headers, body: payload });
  } catch {
    throw new ApiError("Network error. Check your internet connection.", 0);
  }

  let data = {};
  try {
    data = await res.json();
  } catch {
    /* empty or non-JSON body */
  }

  if (!res.ok) {
    if (res.status === 401 && token) {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    throw new ApiError(data.error || `Request failed (${res.status})`, res.status, data);
  }
  return data;
}

/** GET a file (PDF) with the same auth handling → Blob */
export async function apiBlob(path) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { headers });
  } catch {
    throw new ApiError("Network error. Check your internet connection.", 0);
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.error || `Request failed (${res.status})`, res.status, data);
  }
  return res.blob();
}
