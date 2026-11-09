// src/services/crypto.service.js
// Small, dependency-free helpers for secrets at rest.
//
//   hashSecret(v)        HMAC-SHA256 — for codes we only need to COMPARE
//                        (customer login OTP, kiosk OTP / QR lookup, IPs in consent records)
//   encryptString(s)     AES-256-GCM — for short values we must show again
//   decryptString(s)       (the kiosk OTP on the customer's own page)
//   encryptBuffer(b)     AES-256-GCM — customer documents in storage
//   decryptBuffer(b)       (plain, unencrypted buffers are returned unchanged,
//                          so files stored before this change still print)
//   signParams / verifyParams   expiring HMAC-signed links (file downloads, scan uploads)
//
// Key: DATA_ENCRYPTION_KEY (64 hex chars). If missing, derived from JWT_SECRET.
const crypto = require("crypto");
const env = require("../config/env");

const master = env.DATA_ENCRYPTION_KEY
  ? Buffer.from(env.DATA_ENCRYPTION_KEY, "hex")
  : crypto.createHash("sha256").update(`snapprints-data-key|${env.JWT_SECRET}`).digest();

const derive = (label) => crypto.createHmac("sha256", master).update(label).digest();
const ENC_KEY = derive("enc-v1");
const MAC_KEY = derive("mac-v1");
const LINK_KEY = derive("link-v1");

const FILE_MAGIC = Buffer.from("SPE1"); // marks an encrypted file

function hashSecret(value) {
  if (value === null || value === undefined || value === "") return null;
  return crypto.createHmac("sha256", MAC_KEY).update(String(value)).digest("hex");
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

function encryptString(text) {
  if (text === null || text === undefined) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", ENC_KEY, iv);
  const ct = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64")}`;
}

function decryptString(value) {
  if (!value || !String(value).startsWith("v1:")) return null;
  try {
    const raw = Buffer.from(String(value).slice(3), "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", ENC_KEY, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

function encryptBuffer(buffer) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", ENC_KEY, iv);
  const ct = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return Buffer.concat([FILE_MAGIC, iv, cipher.getAuthTag(), ct]);
}

const isEncryptedBuffer = (buffer) =>
  Buffer.isBuffer(buffer) && buffer.length > 32 && buffer.subarray(0, 4).equals(FILE_MAGIC);

/* Throws if the file was encrypted with another key or has been tampered with. */
function decryptBuffer(buffer) {
  if (!isEncryptedBuffer(buffer)) return buffer;
  const decipher = crypto.createDecipheriv("aes-256-gcm", ENC_KEY, buffer.subarray(4, 16));
  decipher.setAuthTag(buffer.subarray(16, 32));
  return Buffer.concat([decipher.update(buffer.subarray(32)), decipher.final()]);
}

/* ── Expiring signed links ──
   params: plain object of strings. Returns { ...params, exp, sig }. */
function signParams(op, params, ttlSeconds) {
  const exp = String(Math.floor(Date.now() / 1000) + ttlSeconds);
  const payload = canonical(op, { ...params, exp });
  const sig = crypto.createHmac("sha256", LINK_KEY).update(payload).digest("hex");
  return { ...params, exp, sig };
}

function verifyParams(op, query, keys) {
  if (!query || !query.sig || !query.exp) return false;
  if (Number(query.exp) < Math.floor(Date.now() / 1000)) return false;
  const params = { exp: String(query.exp) };
  for (const k of keys) params[k] = query[k] === undefined ? "" : String(query[k]);
  const expected = crypto.createHmac("sha256", LINK_KEY).update(canonical(op, params)).digest("hex");
  return safeEqual(expected, query.sig);
}

function canonical(op, params) {
  return [op, ...Object.keys(params).sort().map((k) => `${k}=${params[k]}`)].join("\n");
}

const randomHex = (bytes = 16) => crypto.randomBytes(bytes).toString("hex");

module.exports = {
  hashSecret,
  safeEqual,
  encryptString,
  decryptString,
  encryptBuffer,
  decryptBuffer,
  isEncryptedBuffer,
  signParams,
  verifyParams,
  randomHex,
};
