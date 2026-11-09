// src/screen.js — the shopkeeper's screen at http://localhost:7300
// Only reachable from this computer (listens on 127.0.0.1).
//
// Shows: connection, printers (pause / resume), what's printing, today's orders
// with their pickup codes, and buttons to fix problems:
//   "Print again"  → a stuck / jammed order goes back in the queue
//   "Mark done"    → it did print, close it
//   "Refund"       → it can't be printed, give the money back
// Photocopy / scan orders (done by hand at the counter):
//   "Start" → "Done", and for scans "Upload scan" (pick the scanned PDF / photo)
const express = require("express");

function startScreen({ cfg, state, api, heartbeat, kick, log }) {
  const app = express();
  app.use(express.json());

  let recent = [];
  let recentAt = 0;
  async function getRecent() {
    if (Date.now() - recentAt < 3000) return recent;
    try {
      recent = (await api.get("/agent/jobs/recent")).jobs;
      recentAt = Date.now();
    } catch {
      /* keep the last list */
    }
    return recent;
  }

  app.get("/api/state", async (req, res) => {
    res.json({ ...state, orders: await getRecent() });
  });

  app.post("/api/printers/:id/enabled", async (req, res) => {
    try {
      await api.patch(`/agent/printers/${encodeURIComponent(req.params.id)}`, { isEnabled: !!req.body.enabled });
      await heartbeat();
      log(`Printer ${req.params.id} ${req.body.enabled ? "resumed" : "paused"} from the shop screen`);
      kick();
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Scan orders: the shopkeeper picks the scanned file → we upload it, then mark it done
  app.post("/api/jobs/:jobId/scan", express.raw({ type: () => true, limit: "60mb" }), async (req, res) => {
    try {
      const id = encodeURIComponent(req.params.jobId);
      if (!req.body || !req.body.length) return res.status(400).json({ error: "Choose the scanned file first" });
      const { url } = await api.post(`/agent/jobs/${id}/scan-url`);
      await api.putRaw(url, req.body, req.headers["content-type"] || "application/pdf");
      await api.post(`/agent/jobs/${id}/printed`);
      recentAt = 0;
      log(`Scan for order ${req.params.jobId} uploaded — the customer can download it now`);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  const actions = {
    start: (id) => api.post(`/agent/jobs/${id}/start`),
    requeue: (id) => api.post(`/agent/jobs/${id}/requeue`),
    printed: (id) => api.post(`/agent/jobs/${id}/printed`),
    failed: (id) => api.post(`/agent/jobs/${id}/failed`, { reason: "Cancelled at the shop" }),
  };
  app.post("/api/jobs/:jobId/:action", async (req, res) => {
    const fn = actions[req.params.action];
    if (!fn) return res.status(404).json({ error: "Unknown action" });
    try {
      await fn(encodeURIComponent(req.params.jobId));
      recentAt = 0;
      log(`Order ${req.params.jobId}: ${req.params.action} (from the shop screen)`);
      if (req.params.action === "requeue") kick();
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get("/", (req, res) => res.type("html").send(PAGE));

  const port = cfg.screenPort || 7300;
  app.listen(port, "127.0.0.1", () => console.log(`Shop screen: http://localhost:${port}\n`))
    .on("error", (err) => console.error(`Shop screen could not start on port ${port}: ${err.message}`));
}

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SnapPrints — Shop</title>
<style>
  :root{--bg:#f4f6fb;--card:#fff;--ink:#14213d;--muted:#5c6b84;--line:#e3e8f2;--brand:#2457ff;--ok:#15803d;--okbg:#e7f6ec;--warn:#b45309;--warnbg:#fff4e0;--bad:#b91c1c;--badbg:#fdeaea}
  *{box-sizing:border-box}body{margin:0;font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink)}
  header{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:14px 20px;background:var(--ink);color:#fff}
  header h1{font-size:18px;margin:0}header .sp{flex:1}
  .pill{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:99px;font-size:13px;font-weight:600}
  .pill.ok{background:var(--okbg);color:var(--ok)}.pill.bad{background:var(--badbg);color:var(--bad)}.pill.warn{background:var(--warnbg);color:var(--warn)}
  .dot{width:8px;height:8px;border-radius:50%;background:currentColor}
  main{max-width:1100px;margin:0 auto;padding:18px 16px 40px}
  h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:22px 0 10px}
  .printers{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px}
  .card b{font-size:16px}.small{font-size:13px;color:var(--muted)}
  button{font:inherit;font-size:13px;font-weight:600;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--ink);padding:6px 12px;cursor:pointer}
  button:hover{border-color:var(--brand);color:var(--brand)}button.danger:hover{border-color:var(--bad);color:var(--bad)}
  .now{display:flex;align-items:center;gap:16px}.code{font:800 34px/1 ui-monospace,Consolas,monospace;letter-spacing:.04em}
  table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:middle}
  th{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);background:#fafbfe}
  td.c{font:800 22px ui-monospace,Consolas,monospace}
  .st{font-size:12px;font-weight:700;padding:2px 8px;border-radius:99px}
  .PAID{background:#eef2ff;color:#3730a3}.PRINTING{background:#e0f2fe;color:#075985}.PRINTED{background:var(--okbg);color:var(--ok)}.FAILED,.EXPIRED{background:var(--badbg);color:var(--bad)}
  .acts{display:flex;gap:6px;flex-wrap:wrap}.empty{padding:22px;text-align:center;color:var(--muted)}
  .log{font:12px ui-monospace,Consolas,monospace;background:#0f172a;color:#cbd5e1;border-radius:12px;padding:12px;max-height:220px;overflow:auto;white-space:pre-wrap}
  .log .error{color:#fca5a5}
  @media (max-width:700px){.hide-m{display:none}}
</style></head><body>
<header><h1>SnapPrints · Shop</h1><span id="mid" class="small" style="color:#cbd5e1"></span><span class="sp"></span><span id="conn"></span><span id="dry"></span></header>
<main>
  <div id="err"></div>
  <h2>Now printing</h2><div id="now" class="card small">Nothing right now.</div>
  <h2>Printers</h2><div id="printers" class="printers"></div>
  <h2>Orders (last 24 hours)</h2><div id="orders"></div>
  <h2>Activity</h2><div id="log" class="log"></div>
</main>
<script>
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const time=t=>t?new Date(t).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}):"";
async function post(url,body){const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body||{})});if(!r.ok){const d=await r.json().catch(()=>({}));alert(d.error||"Failed")}load()}
function act(id,a){const msg={start:"Start this order now?",requeue:"Send this order to the printer again?",printed:"Mark this order as done and collected?",failed:"Refund this order? The customer gets their money back and it will not be done."}[a];if(confirm(msg))post("/api/jobs/"+encodeURIComponent(id)+"/"+a)}
function scan(id){const i=document.createElement("input");i.type="file";i.accept=".pdf,.jpg,.jpeg,.png";i.onchange=async()=>{const f=i.files[0];if(!f)return;const r=await fetch("/api/jobs/"+encodeURIComponent(id)+"/scan",{method:"POST",headers:{"Content-Type":f.type||"application/pdf"},body:f});if(!r.ok){const d=await r.json().catch(()=>({}));alert(d.error||"Upload failed")}load()};i.click()}
const TYPE={PRINT:"Print",FORM:"Form",COPY:"Photocopy",SCAN:"Scan"};
function tog(id,en){post("/api/printers/"+id+"/enabled",{enabled:en})}
async function load(){
  let s;try{s=await (await fetch("/api/state")).json()}catch{document.getElementById("conn").innerHTML='<span class="pill bad"><span class="dot"></span>Agent stopped</span>';return}
  document.getElementById("mid").textContent=s.machineId;
  document.getElementById("conn").innerHTML=s.serverOk?(s.socketConnected?'<span class="pill ok"><span class="dot"></span>Online</span>':'<span class="pill warn"><span class="dot"></span>Online (checking every 15 s)</span>'):'<span class="pill bad"><span class="dot"></span>No internet / server</span>';
  document.getElementById("dry").innerHTML=s.dryRun?'<span class="pill warn">DRY-RUN — saving PDFs, not printing</span>':"";
  document.getElementById("err").innerHTML=s.lastError?'<div class="card" style="border-color:#f5c2c2;background:var(--badbg);color:var(--bad);margin-top:6px">'+esc(s.lastError)+"</div>":"";
  document.getElementById("now").innerHTML=s.current?'<div class="now"><span class="code">'+esc(s.current.orderCode)+'</span><div><b>'+esc(s.current.step)+'</b><div class="small">on '+esc(s.current.printer)+'</div></div></div>':"Nothing right now.";
  document.getElementById("printers").innerHTML=s.printers.map(p=>{
    const cls=!p.isEnabled?"warn":p.status==="ONLINE"?"ok":"bad";const label=!p.isEnabled?"Paused":p.status==="ONLINE"?"Ready":p.status==="ERROR"?"Problem":"Offline";
    return '<div class="card"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><b>'+esc(p.displayName)+'</b><span class="pill '+cls+'"><span class="dot"></span>'+label+'</span></div>'+
    '<div class="small" style="margin:6px 0 10px">'+(p.kind==="COLOR"?"Colour + B&W":"B&W only")+(p.duplex?" · double-sided":"")+" · "+esc((p.paperSizes||[]).join("/"))+(p.message?"<br>"+esc(p.message):"")+'</div>'+
    (p.id?(p.isEnabled?'<button onclick="tog('+p.id+',false)">Pause</button>':'<button onclick="tog('+p.id+',true)">Resume</button>'):"")+"</div>"}).join("");
  const o=s.orders||[];
  document.getElementById("orders").innerHTML=o.length?'<table><thead><tr><th>Code</th><th>Order</th><th class="hide-m">Printer</th><th>Status</th><th class="hide-m">Time</th><th></th></tr></thead><tbody>'+o.map(j=>{
    const man=j.job_type==="COPY"||j.job_type==="SCAN";const a=[];
    if(man&&j.status==="PAID")a.push('<button onclick="act(\\''+j.job_id+'\\',\\'start\\')">Start</button>');
    if(man&&j.status==="PRINTING"){if(j.job_type==="SCAN")a.push('<button onclick="scan(\\''+j.job_id+'\\')">Upload scan</button>');else a.push('<button onclick="act(\\''+j.job_id+'\\',\\'printed\\')">Done</button>')}
    if(!man&&j.status==="PRINTING"){a.push('<button onclick="act(\\''+j.job_id+'\\',\\'requeue\\')">Print again</button>','<button onclick="act(\\''+j.job_id+'\\',\\'printed\\')">Mark done</button>')}
    if(j.status==="PAID"||j.status==="PRINTING")a.push('<button class="danger" onclick="act(\\''+j.job_id+'\\',\\'failed\\')">Refund</button>');
    return "<tr><td class=c>"+esc(j.order_code||"—")+"</td><td><b>"+esc(TYPE[j.job_type]||"Print")+"</b> · "+(j.job_type==="SCAN"?"":esc(j.copies)+"× ")+esc(j.total_pages)+" page"+(j.total_pages>1?"s":"")+" · "+(j.color==="color"?"Colour":"B&W")+(j.print_side==="duplex"?" · 2-sided":"")+" · "+esc(j.paper_size)+'<div class="small">'+esc(j.file_name)+" · ₹"+esc(j.amount)+(j.fail_reason?" · "+esc(j.fail_reason):"")+'</div></td><td class="hide-m small">'+esc(j.printer_name||"")+'</td><td><span class="st '+esc(j.status)+'">'+({PAID:"In queue",PRINTING:"Printing",PRINTED:"Printed",FAILED:"Refunded",EXPIRED:"Expired"}[j.status]||esc(j.status))+'</span></td><td class="hide-m small">'+time(j.printed_at||j.updated_at)+'</td><td><div class="acts">'+a.join("")+"</div></td></tr>"}).join("")+"</tbody></table>":'<div class="card empty">No orders yet today.</div>';
  document.getElementById("log").innerHTML=(s.log||[]).map(l=>'<div class="'+l.level+'">'+time(l.at)+"  "+esc(l.msg)+"</div>").join("");
}
load();setInterval(load,3000);
</script></body></html>`;

module.exports = { startScreen };
