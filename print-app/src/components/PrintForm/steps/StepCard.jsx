// steps/StepCard.jsx — "Photo of card": the phone camera as a photocopier.
//
//   1. Pick the card type (Aadhaar, PAN, licence, voter ID, other).
//   2. "Take photo of front" → the camera opens with a card-shaped frame
//      (or the phone's own camera app when live camera isn't available).
//   3. The card's corners are found automatically and the photo is flattened
//      into a straight card. If the edges weren't found, the customer drags the
//      four corners. A quality check asks for a retake when it's blurry / dark.
//   4. Same for the back, if the card has one. More cards can be added.
//   5. Everything is laid out on one A4 page at REAL card size (85.6 × 54 mm),
//      front above back — exactly like a shop xerox — in B&W or colour.
//
// All image work happens on the phone. Only the finished page is uploaded,
// through the normal upload → pay → print flow, and it is deleted after printing.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MdPhotoCamera, MdPhotoLibrary, MdDelete, MdAdd, MdCached, MdClose } from "react-icons/md";
import OptionsGrid from "./OptionsGrid";
import { useT } from "../../../i18n";
import { CARD_MM, CARD_ASPECT, detectCard, warpQuad, quality, enhance, rotate180 } from "../../../utils/cardImage";

/* ── Card types ─────────────────────────────────────────────────────────── */
export const CARD_TYPES = [
  { id: "AADHAAR", back: true },
  { id: "PAN", back: false },
  { id: "DL", back: true },
  { id: "VOTER", back: true },
  { id: "OTHER", back: true },
];

/* ── Real sizes ─────────────────────────────────────────────────────────── */
const DPI = 300;
const PX_PER_MM = DPI / 25.4;
const CARD_PX = { w: Math.round(CARD_MM.w * PX_PER_MM), h: Math.round(CARD_MM.h * PX_PER_MM) }; // 1011 × 638
// The server places an image on A4 inside a 24 pt margin, scaled to fit. We draw
// exactly that printable area, so the cards come out at real size.
const PT_TO_MM = 25.4 / 72;
const PAGE_MM = { w: 210 - 2 * 24 * PT_TO_MM, h: 297 - 2 * 24 * PT_TO_MM }; // ≈ 193.1 × 280.1
const PAGE_PX = { w: Math.round(PAGE_MM.w * PX_PER_MM), h: Math.round(PAGE_MM.h * PX_PER_MM) };
const TOP_MM = 6;
const COL_GAP_MM = 10;
const ROW_GAP_MM = 8;
const SIDE_GAP_MM = 4;
const DETECT_MAX = 600; // corner detection runs on a small copy
const FILE_NAME = "ID-card-copy.jpg";

/* ── Canvas helpers ─────────────────────────────────────────────────────── */
const canvasOf = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
const toImageData = (canvas) => canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
function fromPixels(px) {
  const c = canvasOf(px.width, px.height);
  c.getContext("2d").putImageData(new ImageData(px.data, px.width, px.height), 0, 0);
  return c;
}
/* Any image / video frame → canvas, at most `max` px on the long side. */
function drawScaled(source, sw, sh, max) {
  const k = Math.min(1, max / Math.max(sw, sh));
  const c = canvasOf(Math.round(sw * k), Math.round(sh * k));
  c.getContext("2d").drawImage(source, 0, 0, c.width, c.height);
  return c;
}
function loadFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve(drawScaled(img, img.naturalWidth, img.naturalHeight, 2400)); URL.revokeObjectURL(url); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode")); };
    img.src = url;
  });
}

/* Two columns of card blocks (front above back). Returns null if it doesn't fit one page. */
export function layoutCards(cards) {
  const blocks = cards.map((c) => c.sides.filter(Boolean).length).filter((n) => n > 0);
  const blockH = (n) => n * CARD_MM.h + (n - 1) * SIDE_GAP_MM;
  const left = (PAGE_MM.w - 2 * CARD_MM.w - COL_GAP_MM) / 2;
  const pos = [];
  let y = TOP_MM;
  for (let i = 0; i < blocks.length; i += 2) {
    const rowH = Math.max(blockH(blocks[i]), blocks[i + 1] ? blockH(blocks[i + 1]) : 0);
    if (y + rowH > PAGE_MM.h) return null;
    // a card alone in its row is centred, like it would be on a shop's copier glass
    pos.push({ x: blocks[i + 1] ? left : (PAGE_MM.w - CARD_MM.w) / 2, y });
    if (blocks[i + 1]) pos.push({ x: left + CARD_MM.w + COL_GAP_MM, y });
    y += rowH + ROW_GAP_MM;
  }
  return pos;
}

async function buildPage(cards, mode) {
  const pos = layoutCards(cards);
  if (!pos) throw new Error("full");
  const page = canvasOf(PAGE_PX.w, PAGE_PX.h);
  const ctx = page.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, PAGE_PX.w, PAGE_PX.h);
  cards.filter((c) => c.sides.some(Boolean)).forEach((card, i) => {
    let y = pos[i].y;
    card.sides.filter(Boolean).forEach((side) => {
      const look = fromPixels(enhance(toImageData(side), mode));
      const X = Math.round(pos[i].x * PX_PER_MM), Y = Math.round(y * PX_PER_MM);
      ctx.drawImage(look, X, Y, CARD_PX.w, CARD_PX.h);
      ctx.strokeStyle = "#9a9a9a"; // thin edge, like a photocopied card
      ctx.lineWidth = 2;
      ctx.strokeRect(X, Y, CARD_PX.w, CARD_PX.h);
      y += CARD_MM.h + SIDE_GAP_MM;
    });
  });
  const blob = await new Promise((resolve) => page.toBlob(resolve, "image/jpeg", 0.9));
  const file = new File([blob], FILE_NAME, { type: "image/jpeg" });
  file.snapSource = "CARD";
  return { file, url: URL.createObjectURL(blob) };
}

/* ── Live camera with a card-shaped frame ───────────────────────────────── */
function CameraView({ title, onPhoto, onFallback, onGallery, onCancel }) {
  const { t } = useT();
  const videoRef = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stream = null;
    let stopped = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((s) => {
        if (stopped) { s.getTracks().forEach((tr) => tr.stop()); return; }
        stream = s;
        const v = videoRef.current;
        v.srcObject = s;
        v.play().then(() => setReady(true)).catch(() => setReady(true));
      })
      .catch(() => onFallback());
    return () => { stopped = true; if (stream) stream.getTracks().forEach((tr) => tr.stop()); };
  }, [onFallback]);

  const capture = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    onPhoto(drawScaled(v, v.videoWidth, v.videoHeight, 2400));
  };

  // Full screen, above everything (rendered on <body>, outside the card layout)
  return createPortal(
    <div className="pf-camera" role="dialog" aria-modal="true" aria-label={title}>
      <div className="pf-camera-top">
        <span>{title}</span>
        <button type="button" className="pf-camera-x" onClick={onCancel} aria-label={t("card.cancel")}><MdClose size={22} /></button>
      </div>
      <div className="pf-camera-view">
        <video ref={videoRef} playsInline muted autoPlay />
        <div className="pf-camera-frame" style={{ aspectRatio: `${CARD_MM.w} / ${CARD_MM.h}` }} aria-hidden="true" />
      </div>
      <p className="pf-camera-hint">{t("card.cameraHint")}</p>
      <div className="pf-camera-actions">
        <button type="button" className="pf-btn ghost" onClick={onGallery}><MdPhotoLibrary size={18} aria-hidden="true" /> {t("card.gallery")}</button>
        <button type="button" className="pf-camera-shutter" onClick={capture} disabled={!ready} aria-label={t("card.capture")} />
      </div>
    </div>,
    document.body
  );
}

/* ── Corners: found automatically, draggable when they're not right ─────── */
function CornerEditor({ photo, onUse, onRetake }) {
  const { t } = useT();
  const boxRef = useRef(null);
  const small = useMemo(() => drawScaled(photo, photo.width, photo.height, DETECT_MAX), [photo]);
  const detected = useMemo(() => detectCard(toImageData(small)), [small]);
  const [corners, setCorners] = useState(detected.corners);
  const [view, setView] = useState(null); // displayed width / height
  const drag = useRef(null);

  useEffect(() => {
    const measure = () => {
      const w = boxRef.current ? boxRef.current.clientWidth : 320;
      setView({ w, h: (w * small.height) / small.width });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [small]);

  const k = view ? view.w / small.width : 1; // small px → screen px
  const onDown = (i) => (e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = i; };
  const onMove = (e) => {
    if (drag.current === null) return;
    const r = boxRef.current.getBoundingClientRect();
    const x = Math.min(small.width, Math.max(0, (e.clientX - r.left) / k));
    const y = Math.min(small.height, Math.max(0, (e.clientY - r.top) / k));
    setCorners((c) => c.map((p, i) => (i === drag.current ? { x, y } : p)));
  };
  const onUp = () => { drag.current = null; };
  const nudge = (i) => (e) => {
    const step = 4 / k;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    setCorners((c) => c.map((p, j) => (j === i ? { x: p.x + d[0], y: p.y + d[1] } : p)));
  };

  const use = () => {
    const scale = photo.width / small.width;
    onUse(fromPixels(warpQuad(toImageData(photo), corners, CARD_PX.w, CARD_PX.h, scale)));
  };

  const pts = corners.map((p) => `${p.x * k},${p.y * k}`).join(" ");
  const names = ["topLeft", "topRight", "bottomRight", "bottomLeft"];
  return (
    <div className="pf-corners">
      <p className="pf-section-title">{t("card.cornersTitle")}</p>
      {!detected.found ? <div className="pf-alert warning" role="status">{t("card.notFound")}</div> : null}
      <div ref={boxRef} className="pf-corners-box" onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        {view ? (
          <>
            <img src={small.toDataURL("image/jpeg", 0.85)} alt="" style={{ width: view.w, height: view.h }} draggable={false} />
            <svg width={view.w} height={view.h} aria-hidden="true">
              <polygon points={pts} />
            </svg>
            {corners.map((p, i) => (
              <button
                key={names[i]}
                type="button"
                className="pf-corner"
                style={{ left: p.x * k, top: p.y * k }}
                onPointerDown={onDown(i)}
                onKeyDown={nudge(i)}
                aria-label={t(`card.corner.${names[i]}`)}
              />
            ))}
          </>
        ) : null}
      </div>
      <p className="pf-card-hint">{t("card.cornersHint")}</p>
      <div className="pf-crop-actions">
        <button type="button" className="pf-btn ghost" onClick={onRetake}>{t("card.retake")}</button>
        <button type="button" className="pf-btn primary" onClick={use}>{t("card.usePhoto")}</button>
      </div>
    </div>
  );
}

/* ── Check the flattened card before keeping it ─────────────────────────── */
function CheckView({ flat, mode, onKeep, onRetake, onTurn }) {
  const { t } = useT();
  const preview = useMemo(() => {
    const small = drawScaled(flat, flat.width, flat.height, 640);
    const q = quality(toImageData(small));
    return { url: fromPixels(enhance(toImageData(small), mode)).toDataURL("image/jpeg", 0.85), problem: q.problem };
  }, [flat, mode]);
  return (
    <div className="pf-corners">
      <p className="pf-section-title">{t("card.checkTitle")}</p>
      <img className="pf-card-check-img" src={preview.url} alt={t("card.checkTitle")} style={{ aspectRatio: `${CARD_ASPECT}` }} />
      {preview.problem ? <div className="pf-alert warning" role="alert">⚠ {t(`card.q.${preview.problem}`)}</div> : null}
      <button type="button" className="pf-btn ghost small" onClick={onTurn}><MdCached size={18} aria-hidden="true" /> {t("card.turn")}</button>
      <div className="pf-crop-actions">
        <button type="button" className={`pf-btn ${preview.problem ? "primary" : "ghost"}`} onClick={onRetake}>{t("card.retake")}</button>
        <button type="button" className={`pf-btn ${preview.problem ? "ghost" : "primary"}`} onClick={onKeep}>
          {preview.problem ? t("card.useAnyway") : t("card.usePhoto")}
        </button>
      </div>
    </div>
  );
}

/* ── The step ───────────────────────────────────────────────────────────── */
export default function StepCard({
  setGeneratedFile, file,
  color, setColor, copies, setCopies, printSide, setPrintSide, paperSize, setPaperSize, allowed,
  isLocked, jobError,
}) {
  const { t } = useT();
  const [cards, setCards] = useState([]); // [{ id, type, hasBack, sides: [frontCanvas|null, backCanvas|null] }]
  const [picking, setPicking] = useState(true); // card type chooser open
  const [target, setTarget] = useState(null); // { cardId, side: 0|1 } being photographed
  const [mode, setMode] = useState(null); // "camera" | "edit" | "check"
  const [photo, setPhoto] = useState(null);
  const [flat, setFlat] = useState(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(null); // { url }
  const [building, setBuilding] = useState(false);
  const fileRef = useRef(null);
  const galleryRef = useRef(null);
  const liveCamera = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;
  const look = color === "color" ? "color" : "bw";

  const ready = cards.length > 0 && cards.every((c) => c.sides[0] && (!c.hasBack || c.sides[1]));

  /* Cards changed (or B&W ↔ colour) → rebuild the A4 page; it goes to the
     upload step only when every card has all its sides. */
  useEffect(() => {
    let cancelled = false;
    if (!cards.some((c) => c.sides.some(Boolean))) {
      setGeneratedFile(null);
      setPage(null);
      return undefined;
    }
    setBuilding(true);
    buildPage(cards, look)
      .then((r) => {
        if (cancelled) { URL.revokeObjectURL(r.url); return; }
        setGeneratedFile(ready ? r.file : null);
        setPage((old) => { if (old) URL.revokeObjectURL(old.url); return { url: r.url }; });
      })
      .catch(() => { if (!cancelled) setError(t("card.readError")); })
      .finally(() => { if (!cancelled) setBuilding(false); });
    return () => { cancelled = true; };
  }, [cards, look, ready, setGeneratedFile, t]);

  const startShot = (cardId, side) => {
    setError("");
    setTarget({ cardId, side });
    if (liveCamera) setMode("camera");
    else fileRef.current.click();
  };
  const addCard = (type) => {
    const def = CARD_TYPES.find((c) => c.id === type) || CARD_TYPES[4];
    const id = `${Date.now()}`;
    setCards((list) => [...list, { id, type, hasBack: def.back, sides: [null, null] }]);
    setPicking(false);
    startShot(id, 0);
  };
  const gotPhoto = (canvas) => { setPhoto(canvas); setMode("edit"); };
  // No live camera (permission refused, old browser) → the phone's own camera app
  const cameraApp = useCallback(() => { setMode(null); if (fileRef.current) fileRef.current.click(); }, []);
  const gallery = useCallback(() => { setMode(null); if (galleryRef.current) galleryRef.current.click(); }, []);
  const onFile = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = ""; // allow the same photo again
    if (!f) return;
    try {
      gotPhoto(await loadFile(f));
    } catch {
      setError(t("card.readError"));
      setMode(null);
    }
  };
  const cancelShot = () => {
    // A brand-new card with no photo yet is dropped again
    setCards((list) => list.filter((c) => c.sides.some(Boolean) || c.id !== target?.cardId));
    setMode(null); setPhoto(null); setFlat(null); setTarget(null);
  };
  const keep = () => {
    const { cardId, side } = target;
    const saved = flat;
    setCards((list) => list.map((c) => (c.id === cardId ? { ...c, sides: c.sides.map((s, i) => (i === side ? saved : s)) } : c)));
    setMode(null); setPhoto(null); setFlat(null); setTarget(null);
    // Front done and the card has a back → straight on to the back
    const card = cards.find((c) => c.id === cardId);
    if (side === 0 && card && card.hasBack && !card.sides[1]) setTimeout(() => startShot(cardId, 1), 0);
  };
  const turn = () => setFlat((f) => fromPixels(rotate180(toImageData(f))));
  const removeCard = (id) => setCards((list) => list.filter((c) => c.id !== id));
  const skipBack = (id) => setCards((list) => list.map((c) => (c.id === id ? { ...c, hasBack: false, sides: [c.sides[0], null] } : c)));

  // Would one more card still fit on the page?
  const canAddCard = !!layoutCards([...cards, { sides: [1, 1] }]);

  // Real size only works on A4, and one page needs no double-sided printing
  const cardAllowed = allowed
    ? { ...allowed, paperSizes: allowed.paperSizes?.includes("A4") ? ["A4"] : allowed.paperSizes, duplex: false }
    : { colors: ["bw", "color"], paperSizes: ["A4"], duplex: false };

  const sideName = (side) => t(side === 0 ? "card.front" : "card.back");
  const typeName = (type) => t(`card.type.${type}`);
  const shotTitle = target
    ? `${typeName(cards.find((c) => c.id === target.cardId)?.type || "OTHER")} · ${sideName(target.side)}`
    : "";

  const inputs = (
    <>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onFile} hidden />
      <input ref={galleryRef} type="file" accept="image/*" onChange={onFile} hidden />
    </>
  );

  // The file inputs stay mounted in one place whatever is on screen, so a
  // photo picked while the camera view is open still arrives.
  let body;
  if (mode === "camera") {
    body = <CameraView title={shotTitle} onPhoto={gotPhoto} onFallback={cameraApp} onGallery={gallery} onCancel={cancelShot} />;
  } else if (mode === "edit" && photo) {
    body = (
      <div className="pf-step-enter">
        <p className="pf-card-shot">{shotTitle}</p>
        <CornerEditor photo={photo} onRetake={() => { setPhoto(null); startShot(target.cardId, target.side); }}
          onUse={(c) => { setFlat(c); setMode("check"); }} />
      </div>
    );
  } else if (mode === "check" && flat) {
    body = (
      <div className="pf-step-enter">
        <p className="pf-card-shot">{shotTitle}</p>
        <CheckView flat={flat} mode={look} onKeep={keep} onTurn={turn}
          onRetake={() => { setFlat(null); setPhoto(null); startShot(target.cardId, target.side); }} />
      </div>
    );
  }
  if (body) return <>{inputs}{body}</>;

  return (
    <>
    {inputs}
    <div className="pf-step-enter">
      <p className="pf-card-intro">{t("card.intro")}</p>
      {!cards.length ? <p className="pf-card-hint">💡 {t("card.tips")}</p> : null}

      {cards.length ? (
        <ul className="pf-card-list">
          {cards.map((c) => (
            <li key={c.id} className="pf-card-item">
              <div className="pf-card-item-top">
                <strong>{typeName(c.type)}</strong>
                <button type="button" className="pf-remove-btn" onClick={() => removeCard(c.id)} aria-label={t("card.removeCard", { type: typeName(c.type) })}>
                  <MdDelete size={18} aria-hidden="true" />
                </button>
              </div>
              <div className="pf-card-thumbs">
                {[0, 1].filter((s) => s === 0 || c.hasBack).map((s) => (
                  c.sides[s] ? (
                    <button key={s} type="button" className="pf-card-thumb" onClick={() => startShot(c.id, s)} aria-label={t("card.retakeSide", { side: sideName(s) })}>
                      <img src={c.sides[s].toDataURL("image/jpeg", 0.6)} alt="" />
                      <span>{sideName(s)} · {t("card.retake")}</span>
                    </button>
                  ) : (
                    <button key={s} type="button" className="pf-card-thumb empty" onClick={() => startShot(c.id, s)}>
                      <MdPhotoCamera size={20} aria-hidden="true" />
                      <span>{t(s === 0 ? "card.takeFront" : "card.takeBack")}</span>
                    </button>
                  )
                ))}
              </div>
              {c.hasBack && !c.sides[1] && c.sides[0] ? (
                <button type="button" className="pf-link-btn" onClick={() => skipBack(c.id)}>{t("card.skipBack")}</button>
              ) : null}
              {!c.hasBack && c.sides[0] ? (
                <button type="button" className="pf-link-btn" onClick={() => {
                  setCards((list) => list.map((x) => (x.id === c.id ? { ...x, hasBack: true } : x)));
                  startShot(c.id, 1);
                }}>{t("card.addBack")}</button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {picking || !cards.length ? (
        <div className="pf-card-types">
          <p className="pf-section-title" id="pf-card-type">{t("card.pickType")}</p>
          <div className="pf-card-type-grid" role="group" aria-labelledby="pf-card-type">
            {CARD_TYPES.map((ct) => (
              <button key={ct.id} type="button" className="pf-card-type" onClick={() => addCard(ct.id)}>
                <MdPhotoCamera size={18} aria-hidden="true" /> {typeName(ct.id)}
              </button>
            ))}
          </div>
          {cards.length ? <button type="button" className="pf-link-btn" onClick={() => setPicking(false)}>{t("card.cancel")}</button> : null}
        </div>
      ) : canAddCard ? (
        <button type="button" className="pf-btn ghost" onClick={() => setPicking(true)}>
          <MdAdd size={18} aria-hidden="true" /> {t("card.addCard")}
        </button>
      ) : (
        <p className="pf-card-hint">{t("card.pageFull")}</p>
      )}

      {error ? <div className="pf-alert error" role="alert">⚠ {error}</div> : null}

      {page || building ? (
        <div className="pf-card-page">
          <p className="pf-section-title">{t("card.pagePreview")}</p>
          {building && !page ? (
            <div className="pf-preview-loading"><span className="pf-spinner dark" /> <span>{t("card.makingPage")}</span></div>
          ) : (
            <img src={page.url} alt={t("card.pagePreview")} className="pf-card-page-img" />
          )}
          <p className="pf-card-hint">{t("card.pageNote")}</p>
        </div>
      ) : null}

      <p className="pf-card-hint">🔒 {t("card.privacy")}</p>

      {file && ready ? (
        <>
          <div className="pf-divider" />
          <p className="pf-section-title">{t("options.title")}</p>
          <OptionsGrid
            color={color} setColor={setColor}
            copies={copies} setCopies={setCopies}
            printSide={printSide} setPrintSide={setPrintSide}
            paperSize={paperSize} setPaperSize={setPaperSize}
            allowed={cardAllowed}
          />
          <p className="pf-card-hint">{t("card.colorNote")}</p>
        </>
      ) : null}

      {jobError ? <div className="pf-alert error" role="alert" style={{ marginTop: 10 }}>⚠ {jobError}</div> : null}
      {isLocked ? <div className="pf-alert warning" role="alert" style={{ marginTop: 10 }}>⚠ {t("errors.outOfPaper")}</div> : null}
    </div>
    </>
  );
}
