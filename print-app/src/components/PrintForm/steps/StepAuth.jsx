// steps/StepAuth.jsx
import React, { useEffect, useRef } from "react";
import { MdArrowBack, MdLockOutline, MdPhoneIphone } from "react-icons/md";
import { useT } from "../../../i18n";

const OTP_LENGTH = 6;

function OtpBoxes({ value, onChange, disabled }) {
  const { t } = useT();
  const inputsRef = useRef([]);
  const digits = Array.from({ length: OTP_LENGTH }, (_, i) => value[i] || "");

  const focusBox = (index) => {
    const el = inputsRef.current[index];
    if (el) el.focus();
  };

  const handleChange = (index, raw) => {
    const clean = raw.replace(/\D/g, "");

    if (!clean) {
      const chars = value.split("");
      chars[index] = "";
      onChange(chars.join(""));
      return;
    }

    // Handles both a single keystroke and a multi-digit paste landing in one box
    const chars = value.split("");
    for (let i = 0; i < clean.length && index + i < OTP_LENGTH; i++) {
      chars[index + i] = clean[i];
    }
    const next = chars.join("").slice(0, OTP_LENGTH);
    onChange(next);
    focusBox(Math.min(index + clean.length, OTP_LENGTH - 1));
  };

  const handleKeyDown = (index, e) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      focusBox(index - 1);
    }
    if (e.key === "ArrowLeft" && index > 0) focusBox(index - 1);
    if (e.key === "ArrowRight" && index < OTP_LENGTH - 1) focusBox(index + 1);
  };

  const handlePaste = (e) => {
    const raw = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, OTP_LENGTH);
    if (!raw) return;
    e.preventDefault();
    onChange(raw);
    focusBox(Math.min(raw.length, OTP_LENGTH - 1));
  };

  return (
    <div className="pf-otp-boxes" onPaste={handlePaste}>
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => (inputsRef.current[i] = el)}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={digit}
          disabled={disabled}
          autoFocus={i === 0}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          className="pf-otp-cell"
          aria-label={t("auth.digit", { n: i + 1 })}
        />
      ))}
    </div>
  );
}

export default function StepAuth({
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
}) {
  const { t } = useT();
  // Auto-submit the moment all 6 digits are in.
  const autoSubmittedRef = useRef(false);
  useEffect(() => {
    if (otp.length === OTP_LENGTH && !verifying && !autoSubmittedRef.current) {
      autoSubmittedRef.current = true;
      verifyOtp();
    }
    if (otp.length < OTP_LENGTH) {
      autoSubmittedRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp]);

  const handleMobileSubmit = (e) => {
    e.preventDefault();
    submitDetails();
  };

  const handleOtpSubmit = (e) => {
    e.preventDefault();
    verifyOtp();
  };

  const mobileValid = mobile.length === 10;

  return (
    <div className="pf-step-enter pf-auth-screen">
      {phase === "details" ? (
        <form onSubmit={handleMobileSubmit} className="pf-auth-form">
          <div className="pf-auth-hero left">
            <div className="pf-auth-hero-icon">
              <MdPhoneIphone size={24} />
            </div>
            <h2>{t("auth.title")}</h2>
            <p>{t("auth.sub")}</p>
          </div>

          <div className="pf-field">
            <label htmlFor="pf-mobile">{t("auth.mobile")}</label>
            <div className="pf-mobile-field">
              <span className="pf-mobile-flag" aria-hidden="true">🇮🇳</span>
              <span className="pf-mobile-code">+91</span>
              <input
                id="pf-mobile"
                type="tel"
                inputMode="numeric"
                maxLength={10}
                value={mobile}
                onChange={(e) => setMobile(e.target.value.replace(/\D/g, ""))}
                placeholder={t("auth.mobilePh")}
                autoComplete="tel"
                autoFocus
              />
            </div>
          </div>

          {error ? <div className="pf-alert error" role="alert">⚠ {error}</div> : null}

          <p className="pf-auth-consent">{t("auth.smsConsent")}</p>

          <button
            type="submit"
            className="pf-btn primary"
            disabled={submitting || !mobileValid}
          >
            {submitting ? (<><span className="pf-spinner" /> {t("auth.wait")}</>) : t("auth.next")}
          </button>
        </form>
      ) : (
        <form onSubmit={handleOtpSubmit} className="pf-auth-form">
          <button type="button" onClick={changeNumber} className="pf-auth-back">
            <MdArrowBack size={16} aria-hidden="true" /> {t("auth.back")}
          </button>

          <div className="pf-auth-hero left">
            <div className="pf-auth-hero-icon">
              <MdLockOutline size={24} />
            </div>
            <h2>{t("auth.enterCode")}</h2>
            <p>{t("auth.sentTo", { mobile: `+91 ${mobile}` })}</p>
          </div>

          <OtpBoxes value={otp} onChange={setOtp} disabled={verifying} />

          {error ? <div className="pf-alert error" role="alert" style={{ marginTop: 14 }}>⚠ {error}</div> : null}

          <div className="pf-resend-row">
            {resendCooldown > 0 ? (
              <span>{t("auth.resendIn", { s: resendCooldown })}</span>
            ) : (
              <>
                <span>{t("auth.didntGet")}</span>
                <button
                  type="button"
                  onClick={resendOtp}
                  disabled={submitting}
                  className="pf-link-btn"
                >
                  {t("auth.resend")}
                </button>
              </>
            )}
          </div>

          <button
            type="submit"
            className="pf-btn primary"
            disabled={verifying || otp.length !== OTP_LENGTH}
            style={{ marginTop: 18 }}
          >
            {verifying ? (<><span className="pf-spinner" /> {t("auth.verifying")}</>) : t("auth.verify")}
          </button>
        </form>
      )}
    </div>
  );
}