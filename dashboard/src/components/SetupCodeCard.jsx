import React, { useState } from "react";

// Shown once after creating a machine / asking for a new code.
// setup = { MACHINE_ID, SETUP_CODE, EXPIRES_AT, API_BASE }
export default function SetupCodeCard({ setup, module, onClose }) {
  const [copied, setCopied] = useState(false);
  if (!setup) return null;
  const expires = new Date(setup.EXPIRES_AT).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(setup.SETUP_CODE);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the code is on screen anyway */
    }
  };

  return (
    <div className="card p-5 mb-6 bg-amber-50 border-amber-200 max-w-xl">
      <p className="text-sm font-semibold text-amber-800">
        {setup.MACHINE_ID} — setup code (works once, until {expires})
      </p>
      <div className="flex items-center gap-3 my-3">
        <code className="text-2xl font-bold tracking-widest bg-white px-4 py-2 rounded-lg border border-amber-200">
          {setup.SETUP_CODE}
        </code>
        <button className="btn-secondary" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
      </div>
      {module === "SHOP" ? (
        <ol className="text-xs text-amber-900 space-y-1 list-decimal ml-4">
          <li>On the shop's computer, open the <b>shop-agent</b> folder and run <code>npm run setup</code> (or double-click <code>start-agent.bat</code>).</li>
          <li>Server address: <code>{setup.API_BASE}</code></li>
          <li>Enter this code, then pick the B&amp;W and colour copiers.</li>
        </ol>
      ) : (
        <ol className="text-xs text-amber-900 space-y-1 list-decimal ml-4">
          <li>On the Raspberry Pi, register with this code: <code>POST {setup.API_BASE}/devices/register</code></li>
          <li>Older Pi software that registers by serial number still works while <code>ALLOW_LEGACY_PI_REGISTRATION=true</code>.</li>
        </ol>
      )}
      <button className="text-xs text-amber-700 mt-3 underline" onClick={onClose}>Dismiss</button>
    </div>
  );
}
