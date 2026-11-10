// components/ConfirmDialog.jsx
// "Are you sure? Type your password" popup for risky admin changes.
//
// Use it on any page:
//   const confirm = useConfirm();
//   const ok = await confirm({
//     title: "Change role",
//     message: "Viraj will lose access to admin users.",
//     changes: [{ label: "Role", from: "SUPER_ADMIN", to: "ADMIN" }],   // optional
//     typeToConfirm: "SPK1001",          // optional — must type this word too
//     confirmLabel: "Change role",       // optional
//     danger: true,                      // optional — red button
//     run: (password) => adminApi.updateAdminUser(id, { role }, password),
//   });
//   if (ok) reload();
//
// The popup sends the password with the request. If the backend says the
// password is wrong, the popup stays open and shows the error. It resolves
// true when the change was saved, false when the admin cancelled.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Modal, ErrorText } from "./ui";
import { errMsg } from "../api/axiosClient";

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null);
  const confirm = useCallback((options) => new Promise((resolve) => setRequest({ ...options, resolve })), []);
  const finish = (ok) => {
    if (request) request.resolve(ok);
    setRequest(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request && <ConfirmDialog request={request} onDone={finish} />}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return confirm;
}

const show = (v) => (v === null || v === undefined || v === "" ? "—" : String(v));

function ConfirmDialog({ request, onDone }) {
  const { title = "Confirm change", message, changes, typeToConfirm, confirmLabel = "Confirm", danger = false, run } = request;
  const [password, setPassword] = useState("");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef(null);

  useEffect(() => { passwordRef.current?.focus(); }, []);

  const wordOk = !typeToConfirm || typed.trim() === String(typeToConfirm);
  const canSubmit = password.length > 0 && wordOk && !busy;

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    try {
      await run(password);
      onDone(true);
    } catch (err) {
      const code = err?.response?.data?.code;
      if (code === "PASSWORD_WRONG" || code === "PASSWORD_REQUIRED") {
        setPassword("");
        passwordRef.current?.focus();
      }
      setError(errMsg(err, "Could not save the change"));
      setBusy(false);
    }
  };

  return (
    <Modal open title={title} onClose={() => !busy && onDone(false)}>
      <form onSubmit={submit} className="space-y-4">
        {message && <div className="text-sm text-gray-700">{message}</div>}

        {changes && changes.length > 0 && (
          <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 text-sm">
            {changes.map((c) => (
              <div key={c.label} className="flex items-center gap-2 px-3 py-2">
                <span className="w-28 shrink-0 text-xs text-gray-500">{c.label}</span>
                <span className="text-gray-500 line-through decoration-gray-300">{show(c.from)}</span>
                <span className="text-gray-400">→</span>
                <span className="font-medium text-gray-900">{show(c.to)}</span>
              </div>
            ))}
          </div>
        )}

        {typeToConfirm && (
          <label className="block">
            <span className="block text-xs font-medium text-gray-600 mb-1">
              Type <b className="font-mono text-gray-900">{typeToConfirm}</b> to confirm
            </span>
            <input className="input font-mono" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </label>
        )}

        <label className="block">
          <span className="block text-xs font-medium text-gray-600 mb-1">Your password</span>
          <input
            ref={passwordRef}
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <span className="block text-xs text-gray-400 mt-1">We ask again because this change is hard to undo. It is saved in the audit log.</span>
        </label>

        <ErrorText>{error}</ErrorText>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => onDone(false)}>Cancel</button>
          <button className={danger ? "btn-danger" : "btn-primary"} disabled={!canSubmit}>
            {busy ? "Saving…" : confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}