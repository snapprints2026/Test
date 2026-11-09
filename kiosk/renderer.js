// renderer.js — extra screen logic, loaded after the inline script in index.html.
// The keypad, OTP and thank-you screens live in index.html. This file adds the
// PHOTOCOPY / SCAN steps: after the OTP the customer puts each page on the
// scanner glass and taps "Scan page"; "Finish" completes the order.
// Everything is inside one function so nothing clashes with index.html's globals.
(function () {
  const api = window.kioskAPI;
  if (!api || !api.getManualJob) return;

  const LABEL = {
    COPY: { title: "Photocopy", step: "Place page {n} of {total} face down on the scanner glass, then tap Scan page.", each: "{copies} copy/copies of each page will print." },
    SCAN: { title: "Scan to your phone", step: "Place page {n} of {total} face down on the scanner glass, then tap Scan page.", each: "Your PDF will appear on your phone when you tap Finish." },
  };
  const fmt = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => (v[k] === undefined ? "" : v[k]));

  const css = document.createElement("style");
  css.textContent = `
    #manual-panel{position:fixed;inset:0;z-index:99999;background:#0b0b0d;color:#fff;display:flex;flex-direction:column;
      align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center;font-family:inherit}
    #manual-panel h2{font-size:26px;margin:0} #manual-panel .mj-count{font-size:44px;font-weight:800;letter-spacing:2px}
    #manual-panel p{margin:0;max-width:560px;font-size:16px;line-height:1.45;color:#ddd}
    #manual-panel .mj-msg{min-height:22px;color:#f5b942;font-weight:600}
    #manual-panel .mj-row{display:flex;gap:12px;margin-top:6px}
    #manual-panel button{font:inherit;font-size:18px;font-weight:700;border-radius:14px;border:0;padding:16px 26px;min-width:150px;cursor:pointer}
    #mj-scan{background:#fff;color:#000} #mj-finish{background:#1f9d55;color:#fff} #mj-cancel{background:#333;color:#ddd}
    #manual-panel button:disabled{opacity:.45}`;
  document.head.appendChild(css);

  let panel = null;
  let job = null;

  function render(msg) {
    if (!job) return;
    const L = LABEL[job.jobType] || LABEL.COPY;
    const allDone = job.done >= job.pages;
    panel.querySelector("h2").textContent = L.title;
    panel.querySelector(".mj-count").textContent = `${job.done} / ${job.pages}`;
    panel.querySelector(".mj-step").textContent = allDone ? "All pages done — tap Finish." : fmt(L.step, { n: job.done + 1, total: job.pages });
    panel.querySelector(".mj-each").textContent = fmt(L.each, { copies: job.copies });
    if (msg !== undefined) panel.querySelector(".mj-msg").textContent = msg;
    panel.querySelector("#mj-scan").disabled = allDone;
    panel.querySelector("#mj-finish").disabled = job.done === 0;
  }

  async function act(action) {
    panel.querySelectorAll("button").forEach((b) => (b.disabled = true));
    panel.querySelector(".mj-msg").textContent = action === "scan" ? "Scanning…" : "Please wait…";
    const res = await api.manualAction(action);
    job = await api.getManualJob();
    if (!job) {
      close();
      if (res && res.startsWith("✅") && typeof showThankYou === "function") showThankYou();
      else if (typeof setMsg === "function") setMsg(res || "", "");
      return;
    }
    render(res);
  }

  function open() {
    if (typeof clearIdleTimer === "function") clearIdleTimer();
    panel = document.createElement("div");
    panel.id = "manual-panel";
    panel.innerHTML = `<h2></h2><div class="mj-count"></div><p class="mj-step"></p><p class="mj-each"></p>
      <div class="mj-msg" role="status"></div>
      <div class="mj-row"><button id="mj-scan">Scan page</button><button id="mj-finish">Finish</button></div>
      <button id="mj-cancel">Cancel</button>`;
    document.body.appendChild(panel);
    panel.querySelector("#mj-scan").onclick = () => act("scan");
    panel.querySelector("#mj-finish").onclick = () => act("finish");
    panel.querySelector("#mj-cancel").onclick = () => act("cancel");
    render("");
  }

  function close() {
    if (panel) panel.remove();
    panel = null;
    job = null;
  }

  // Wrap index.html's submitOtp: a "📄" answer means a photocopy / scan order started.
  const original = window.submitOtp;
  if (typeof original === "function") {
    window.submitOtp = async function () {
      await original();
      const now = await api.getManualJob();
      if (now && !panel) {
        job = now;
        if (typeof setMsg === "function") setMsg("", "off");
        open();
      }
    };
  }
})();
