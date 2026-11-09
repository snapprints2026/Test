// src/utils/authStorage.js
// Saved login (token + user). Uses localStorage so the customer stays logged
// in across QR scans / closed tabs until the 30-day token expires.
const KEY = "snapprints_auth";

export function loadAuth() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveAuth(auth) {
  try {
    localStorage.setItem(KEY, JSON.stringify(auth));
  } catch {
    /* private mode / storage full — login just won't persist */
  }
}

export function clearAuth() {
  try {
    localStorage.removeItem(KEY);
    sessionStorage.removeItem(KEY); // old versions stored it here
  } catch {
    /* ignore */
  }
}

export function getToken() {
  return loadAuth()?.token || null;
}
