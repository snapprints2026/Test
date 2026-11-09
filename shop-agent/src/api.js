// src/api.js — signed calls to the SnapPrints backend.
// Same signature as the Raspberry Pi kiosks:
//   x-signature = HMAC-SHA256(apiKey, machineId + timestamp + JSON(body))
const crypto = require("crypto");

class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data || {};
  }
}

function signedHeaders(cfg, bodyJson) {
  const ts = String(Date.now());
  const sig = crypto.createHmac("sha256", cfg.apiKey).update(cfg.machineId + ts + bodyJson).digest("hex");
  return {
    "x-machine-id": cfg.machineId,
    "x-timestamp": ts,
    "x-api-key": cfg.apiKey,
    "x-signature": sig,
  };
}

function createApi(cfg) {
  async function request(method, route, body) {
    const bodyJson = body === undefined ? "{}" : JSON.stringify(body);
    const headers = signedHeaders(cfg, bodyJson);
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let res;
    try {
      res = await fetch(`${cfg.apiBase}${route}`, {
        method,
        headers,
        body: body === undefined ? undefined : bodyJson,
        signal: AbortSignal.timeout(30000),
      });
    } catch (err) {
      throw new ApiError(`Cannot reach server (${err.cause?.code || err.name})`, 0);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data.error || `HTTP ${res.status}`, res.status, data);
    return data;
  }
  /* PUT raw bytes to a signed URL (scan upload) */
  async function putRaw(url, buffer, contentType = "application/pdf") {
    const res = await fetch(url, { method: "PUT", headers: { "Content-Type": contentType }, body: buffer, signal: AbortSignal.timeout(120000) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data.error || `HTTP ${res.status}`, res.status, data);
    return data;
  }
  return {
    putRaw,
    get: (route) => request("GET", route),
    post: (route, body = {}) => request("POST", route, body),
    patch: (route, body = {}) => request("PATCH", route, body),
    signedHeaders: (bodyJson = "{}") => signedHeaders(cfg, bodyJson),
  };
}

/* One-time registration with the admin's setup code (no signature yet). */
async function register(apiBase, setupCode, deviceName) {
  const res = await fetch(`${apiBase}/devices/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ setupCode, deviceName }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `HTTP ${res.status}`, res.status, data);
  return data;
}

module.exports = { createApi, register, ApiError };
