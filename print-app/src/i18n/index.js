// src/i18n/index.js — English / हिन्दी / मराठी for the customer page.
//
//   const { t, lang, setLang } = useT();
//   t("pay.button", { amount: 12, action: t("pay.print") })
//
// The first language is: the customer's last choice on this phone → the
// machine's default (set in the admin panel, e.g. Marathi at an RTO) →
// the phone's language → English. <html lang> follows the choice (GIGW).
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import en from "./en";
import hi from "./hi";
import mr from "./mr";

export const LANGUAGES = [
  { code: "en", label: "English", short: "EN" },
  { code: "hi", label: "हिन्दी", short: "हि" },
  { code: "mr", label: "मराठी", short: "म" },
];
const DICTS = { en, hi, mr };
const KEY = "snapprints_lang";

function saved() {
  try {
    const v = localStorage.getItem(KEY);
    return DICTS[v] ? v : null;
  } catch {
    return null;
  }
}

function browserLang() {
  const l = (navigator.language || "en").slice(0, 2).toLowerCase();
  return DICTS[l] ? l : "en";
}

function format(str, vars) {
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));
}

const I18nContext = createContext(null);

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(() => saved() || browserLang());
  const [chosen, setChosen] = useState(() => !!saved());

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((code) => {
    if (!DICTS[code]) return;
    setLangState(code);
    setChosen(true);
    try { localStorage.setItem(KEY, code); } catch { /* private mode */ }
  }, []);

  /* The machine's default language applies until the customer picks one. */
  const applyMachineDefault = useCallback((code) => {
    if (!chosen && DICTS[code]) setLangState(code);
  }, [chosen]);

  const t = useCallback((key, vars) => format(DICTS[lang][key] ?? en[key] ?? key, vars), [lang]);

  const value = useMemo(() => ({ lang, setLang, t, applyMachineDefault }), [lang, setLang, t, applyMachineDefault]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useT must be used inside <LanguageProvider>");
  return ctx;
}
