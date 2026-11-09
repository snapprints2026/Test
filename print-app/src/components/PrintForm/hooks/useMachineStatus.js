// hooks/useMachineStatus.js
// Reads the machine ID from the QR link (?machine=MH100 or ?mh=MH100),
// remembers it for this tab, and polls the machine's status.
// The status says which module the machine runs, which services it offers
// (print / forms / photocopy / scan), how it is paid for, its approved rates
// and its default language:
//   KIOSK (Module 1) — Raspberry Pi, customer types an OTP at the machine
//   SHOP  (Module 2) — shop / counter computer, prints automatically after payment
import { useState, useEffect, useCallback } from "react";
import { getMachineStatus } from "../../../api/machine.api";
import { MACHINE_STATUS_POLL_MS, SHOP_STATUS_POLL_MS, REQUIRE_LOGIN } from "../../../config";

const MACHINE_STORAGE_KEY = "kiosk_machine_id";

function readMachineIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("machine") || params.get("mh") || "";
}

function resolveMachineId() {
  const fromUrl = readMachineIdFromUrl();
  if (fromUrl) {
    // QR scanned — remember it and clean the URL
    try { sessionStorage.setItem(MACHINE_STORAGE_KEY, fromUrl); } catch { /* ignore */ }
    window.history.replaceState({}, "", window.location.pathname);
    return fromUrl;
  }
  // No QR param — page reload in the same tab
  try { return sessionStorage.getItem(MACHINE_STORAGE_KEY) || ""; } catch { return ""; }
}

export function useMachineStatus() {
  const [machineId] = useState(resolveMachineId);
  const [machineStatus, setMachineStatus] = useState(null);
  const [loading, setLoading] = useState(!!machineId);
  // errorKey is an i18n key ("machine.notFound"); errorText is a server message
  const [error, setError] = useState(machineId ? null : { key: "machine.missingTitle" });

  const fetchStatus = useCallback(async () => {
    if (!machineId) return;
    try {
      const data = await getMachineStatus(machineId);
      setMachineStatus(data);
      setError(null);
    } catch (err) {
      setError(err.status === 404 ? { key: "machine.notFound" } : err.message ? { text: err.message } : { key: "machine.statusError" });
    } finally {
      setLoading(false);
    }
  }, [machineId]);

  const module = machineStatus?.module || "KIOSK";
  const isShop = module === "SHOP";

  useEffect(() => {
    if (!machineId) return;
    fetchStatus();
    const interval = setInterval(fetchStatus, isShop ? SHOP_STATUS_POLL_MS : MACHINE_STATUS_POLL_MS);
    return () => clearInterval(interval);
  }, [machineId, fetchStatus, isShop]);

  const isLocked = !!machineStatus?.is_print_locked;
  const requireLogin =
    machineStatus && typeof machineStatus.require_login === "boolean" ? machineStatus.require_login : REQUIRE_LOGIN;

  return {
    machineId,
    machineStatus,
    module,
    isShop,
    capabilities: machineStatus?.capabilities || null,
    jobTypes: machineStatus?.job_types?.length ? machineStatus.job_types : ["PRINT"],
    billingMode: machineStatus?.billing_mode || "CUSTOMER",
    priceTable: machineStatus?.price_table || null,
    privacy: machineStatus?.privacy || null,
    strictPrivacy: !!machineStatus?.strict_privacy,
    defaultLanguage: machineStatus?.default_language || null,
    requireLogin,
    requireOnline: !!machineStatus?.require_online,
    paymentMode: machineStatus?.payment_mode || "razorpay",
    loading,
    error,
    isLocked,
    // Online = the Pi / shop computer checked in during the last 2 minutes AND has paper
    isOnline: !!machineStatus?.is_online && !isLocked,
    refreshStatus: fetchStatus,
  };
}
