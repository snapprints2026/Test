// hooks/useAuth.js
// Customer login: mobile → OTP → token saved in localStorage.
// Next visit on the same device the saved token is checked with /customer/me
// and the customer goes straight to upload (no OTP).
import { useState, useEffect, useCallback } from "react";
import * as authApi from "../../../api/auth.api";
import * as customerApi from "../../../api/customer.api";
import { UNAUTHORIZED_EVENT } from "../../../api/client";
import { loadAuth, saveAuth, clearAuth } from "../../../utils/authStorage";

const MOBILE_REGEX = /^[6-9]\d{9}$/;
const RESEND_COOLDOWN_S = 30;

export function useAuth(t = (k) => k) {
  const [authUser, setAuthUser] = useState(() => loadAuth());
  const [checkingSession, setCheckingSession] = useState(() => !!loadAuth());
  const [phase, setPhase] = useState("details"); // "details" (mobile entry) | "otp"
  const [mobile, setMobile] = useState("");
  const [otp, setOtp] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);

  /* ── Logout (also used when the token turns out to be expired) ── */
  const logout = useCallback(() => {
    clearAuth();
    setAuthUser(null);
    setPhase("details");
    setMobile("");
    setOtp("");
  }, []);

  /* ── On load: is the saved token still valid? ── */
  useEffect(() => {
    if (!loadAuth()) return;
    let cancelled = false;
    customerApi
      .getMe()
      .then((me) => {
        if (cancelled) return;
        // refresh name in case it changed on another device
        setAuthUser((prev) => {
          if (!prev) return prev;
          const updated = { ...prev, user: { ...prev.user, name: me.name } };
          saveAuth(updated);
          return updated;
        });
      })
      .catch((err) => {
        // 401 → token expired/invalid → show login. Network errors keep the session.
        if (!cancelled && err.status === 401) logout();
      })
      .finally(() => !cancelled && setCheckingSession(false));
    return () => {
      cancelled = true;
    };
  }, [logout]);

  /* ── Any API call returning 401 with our token → log out ── */
  useEffect(() => {
    window.addEventListener(UNAUTHORIZED_EVENT, logout);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, logout);
  }, [logout]);

  /* ── Resend countdown ── */
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setInterval(() => setResendCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);

  const persistAuth = useCallback((token, user) => {
    const authData = { token, user, mobile: user.mobile };
    saveAuth(authData);
    setAuthUser(authData);
  }, []);

  const updateName = useCallback((newName) => {
    setAuthUser((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, user: { ...prev.user, name: newName } };
      saveAuth(updated);
      return updated;
    });
  }, []);

  /* ── Step 1: mobile number → OTP is sent ── */
  const submitDetails = useCallback(async () => {
    if (!MOBILE_REGEX.test(mobile.trim())) {
      setError(t("auth.invalidMobile"));
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const result = await authApi.login(mobile.trim());
      if (result.status === "otp_sent") {
        setOtp("");
        setPhase("otp");
        setResendCooldown(RESEND_COOLDOWN_S);
      } else if (result.status === "logged_in" && result.token) {
        // older backend behaviour — still handled
        persistAuth(result.token, result.user);
      } else {
        setError(t("errors.generic"));
      }
    } catch (err) {
      setError(err.message || t("errors.generic"));
    } finally {
      setSubmitting(false);
    }
  }, [mobile, persistAuth, t]);

  const resendOtp = useCallback(async () => {
    if (resendCooldown > 0) return;
    setError("");
    setSubmitting(true);
    try {
      await authApi.resendOtp(mobile.trim());
      setResendCooldown(RESEND_COOLDOWN_S);
    } catch (err) {
      setError(err.message || t("errors.generic"));
    } finally {
      setSubmitting(false);
    }
  }, [mobile, resendCooldown, t]);

  /* ── Step 2: OTP → token ── */
  const verifyOtp = useCallback(async () => {
    if (!otp.trim()) {
      setError(t("auth.enterOtp"));
      return;
    }
    setError("");
    setVerifying(true);
    try {
      const { token, user } = await authApi.verifyOtp(mobile.trim(), otp.trim(), { accepted: true });
      persistAuth(token, user);
    } catch (err) {
      setError(err.message || t("errors.generic"));
    } finally {
      setVerifying(false);
    }
  }, [otp, mobile, persistAuth, t]);

  const changeNumber = useCallback(() => {
    setPhase("details");
    setOtp("");
    setError("");
  }, []);

  return {
    isAuthenticated: !!authUser,
    checkingSession,
    authUser,
    phase,
    mobile, setMobile,
    otp, setOtp,
    submitting,
    verifying,
    error,
    resendCooldown,
    submitDetails,
    resendOtp,
    verifyOtp,
    changeNumber,
    logout,
    updateName,
  };
}
