import React from "react";

// Module 1 = Raspberry Pi kiosk (OTP at the machine)
// Module 2 = xerox shop computer (prints automatically after payment)
export const MODULE_INFO = {
  KIOSK: {
    label: "Kiosk",
    long: "Module 1 — Kiosk (Raspberry Pi)",
    hint: "Customer pays, then types an OTP on the kiosk to print. One printer.",
    className: "bg-violet-100 text-violet-700",
  },
  SHOP: {
    label: "Shop computer",
    long: "Module 2 — Shop computer",
    hint: "Shop's PC prints automatically after payment on its B&W / colour copiers. No OTP.",
    className: "bg-teal-100 text-teal-700",
  },
};

export function parseModules(value) {
  return String(value || "KIOSK")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => MODULE_INFO[s]);
}

export default function ModuleBadge({ module }) {
  const info = MODULE_INFO[module] || MODULE_INFO.KIOSK;
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${info.className}`}>
      {info.label}
    </span>
  );
}
