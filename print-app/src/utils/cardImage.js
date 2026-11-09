// utils/cardImage.js — image maths for "Photo of card", all on the phone.
// Works on plain pixel buffers ({ data: RGBA Uint8ClampedArray, width, height })
// so it runs the same in the browser and in tests. No libraries.
//
//   detectCard()  finds the card's four corners in a photo (edge scan + line fit)
//   warpQuad()    flattens those four corners into a straight card image
//   quality()     sharpness / brightness / glare → ask for a retake if poor
//   enhance()     xerox look: removes shadows, B&W or colour

/* ID-1 card (Aadhaar PVC, PAN, licence, voter ID, bank cards) */
export const CARD_MM = { w: 85.6, h: 54 };
export const CARD_ASPECT = CARD_MM.w / CARD_MM.h; // 1.585

export function toGray(img) {
  const { data, width, height } = img;
  const g = new Float32Array(width * height);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  return g;
}

/* Box blur with an integral image: O(n) for any radius. */
export function boxBlur(src, w, h, r) {
  const ii = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += src[y * w + x];
      ii[(y + 1) * (w + 1) + x + 1] = ii[y * (w + 1) + x + 1] + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const s = ii[y1 * (w + 1) + x1] - ii[y0 * (w + 1) + x1] - ii[y1 * (w + 1) + x0] + ii[y0 * (w + 1) + x0];
      out[y * w + x] = s / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

/* ── Corner detection ──────────────────────────────────────────────────────
   From each side of the image, walk inwards along many scan lines and take the
   first strong edge — on a plain background that is the card's border. A
   robust straight-line fit per side, then the four intersections. */
function edgeProfile(img) {
  // Gradients per colour channel, keep the strongest: a blue PAN card on a
  // grey table has almost the same brightness, but very different colour.
  const { data, width: w, height: h } = img;
  const gx = new Float32Array(w * h), gy = new Float32Array(w * h);
  for (let c = 0; c < 3; c++) {
    const ch = new Float32Array(w * h);
    for (let j = 0, i = c; j < ch.length; j++, i += 4) ch[j] = data[i];
    const g = boxBlur(boxBlur(ch, w, h, 1), w, h, 1);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const vx = (g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1]) - (g[i - w - 1] + 2 * g[i - 1] + g[i + w - 1]);
        const vy = (g[i + w - 1] + 2 * g[i + w] + g[i + w + 1]) - (g[i - w - 1] + 2 * g[i - w] + g[i - w + 1]);
        if (Math.abs(vx) > Math.abs(gx[i])) gx[i] = vx;
        if (Math.abs(vy) > Math.abs(gy[i])) gy[i] = vy;
      }
    }
  }
  return { gx, gy };
}

/* First strong edge along a scan line. `get(k)` = |gradient| at step k. */
function firstEdge(get, n, minStrength) {
  let max = 0;
  for (let k = 2; k < n; k++) max = Math.max(max, get(k));
  const t = Math.max(minStrength, max * 0.45);
  for (let k = 2; k < n - 1; k++) {
    const v = get(k);
    if (v >= t && v >= get(k - 1) && v >= get(k + 1)) return k;
  }
  return -1;
}

/* Fit v = a·u + b, dropping outliers (other edges, text, shadows). */
function robustLine(pts) {
  let use = pts;
  let a = 0, b = 0;
  for (let iter = 0; iter < 4 && use.length >= 4; iter++) {
    let su = 0, sv = 0, suu = 0, suv = 0;
    for (const [u, v] of use) { su += u; sv += v; suu += u * u; suv += u * v; }
    const n = use.length, d = n * suu - su * su;
    if (Math.abs(d) < 1e-9) break;
    a = (n * suv - su * sv) / d;
    b = (sv - a * su) / n;
    const res = [];
    for (const [u, v] of use) res.push(Math.abs(v - (a * u + b)));
    const sorted = [...res].sort((x, y) => x - y);
    const lim = Math.max(1.5, sorted[Math.floor(sorted.length / 2)] * 2.5);
    const next = use.filter((_, i) => res[i] <= lim);
    if (next.length === use.length) break;
    use = next;
  }
  return use.length >= 4 ? { a, b, support: use.length } : null;
}

const cross = (o, p, q) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
function quadArea(q) {
  let s = 0;
  for (let i = 0; i < 4; i++) { const p = q[i], r = q[(i + 1) % 4]; s += p.x * r.y - r.x * p.y; }
  return Math.abs(s) / 2;
}
const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

/* Default when nothing is found: the guide frame, slightly inset. */
export function defaultQuad(w, h) {
  let cw = w * 0.86, ch = cw / CARD_ASPECT;
  if (ch > h * 0.86) { ch = h * 0.86; cw = ch * CARD_ASPECT; }
  const x0 = (w - cw) / 2, y0 = (h - ch) / 2;
  return [{ x: x0, y: y0 }, { x: x0 + cw, y: y0 }, { x: x0 + cw, y: y0 + ch }, { x: x0, y: y0 + ch }];
}

/**
 * @param img { data, width, height } — ideally ≤ 600 px on the long side
 * @returns { corners:[TL,TR,BR,BL] in img pixels, found:boolean }
 */
export function detectCard(img) {
  const { width: w, height: h } = img;
  const { gx, gy } = edgeProfile(img);
  const minStrength = 40;
  const top = [], bottom = [], left = [], right = [];
  const band = 0.62; // the card's edge is within the outer 62 % from each side
  for (let x = Math.round(w * 0.15); x < w * 0.85; x += 2) {
    const kT = firstEdge((k) => Math.abs(gy[k * w + x]), Math.round(h * band), minStrength);
    if (kT > 0) top.push([x, kT]);
    const kB = firstEdge((k) => Math.abs(gy[(h - 1 - k) * w + x]), Math.round(h * band), minStrength);
    if (kB > 0) bottom.push([x, h - 1 - kB]);
  }
  for (let y = Math.round(h * 0.15); y < h * 0.85; y += 2) {
    const kL = firstEdge((k) => Math.abs(gx[y * w + k]), Math.round(w * band), minStrength);
    if (kL > 0) left.push([y, kL]);
    const kR = firstEdge((k) => Math.abs(gx[y * w + (w - 1 - k)]), Math.round(w * band), minStrength);
    if (kR > 0) right.push([y, w - 1 - kR]);
  }
  const need = (n) => n * 0.3;
  const T = top.length > need(w * 0.35) && robustLine(top);
  const B = bottom.length > need(w * 0.35) && robustLine(bottom);
  const L = left.length > need(h * 0.35) && robustLine(left);
  const R = right.length > need(h * 0.35) && robustLine(right);
  if (!T || !B || !L || !R) return { corners: defaultQuad(w, h), found: false };

  // top/bottom: y = a x + b ; left/right: x = a y + b
  const meet = (H, V) => {
    const x = (V.a * H.b + V.b) / (1 - V.a * H.a);
    return { x, y: H.a * x + H.b };
  };
  let q = [meet(T, L), meet(T, R), meet(B, R), meet(B, L)];

  // Sanity checks: convex, big enough, roughly card-shaped, inside the photo.
  const convex = [0, 1, 2, 3].every((i) => cross(q[i], q[(i + 1) % 4], q[(i + 2) % 4]) > 0);
  const inside = q.every((p) => p.x > -w * 0.05 && p.x < w * 1.05 && p.y > -h * 0.05 && p.y < h * 1.05);
  const area = quadArea(q);
  const wAvg = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2;
  const hAvg = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
  let aspect = wAvg / hAvg;
  if (aspect < 1) {
    // Card is sideways in the photo — make its long side the top.
    q = [q[3], q[0], q[1], q[2]];
    aspect = 1 / aspect;
  }
  const ok = convex && inside && area > w * h * 0.12 && aspect > 1.2 && aspect < 2.2;
  return ok ? { corners: q, found: true } : { corners: defaultQuad(w, h), found: false };
}

/* ── Perspective ───────────────────────────────────────────────────────── */
function solve(A, b) {
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / A[c][c];
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const x = new Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k];
    x[r] = s / A[r][r];
  }
  return x;
}

/* Homography taking points `from` → `to` (4 each). */
export function homography(from, to) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i], { x: u, y: v } = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const m = solve(A, b);
  return [...m, 1];
}

/**
 * Flatten the quad [TL,TR,BR,BL] of `src` into an outW × outH image.
 * `scale` = how much bigger src is than the coordinates of `quad`.
 */
export function warpQuad(src, quad, outW, outH, scale = 1) {
  const q = quad.map((p) => ({ x: p.x * scale, y: p.y * scale }));
  const H = homography([{ x: 0, y: 0 }, { x: outW, y: 0 }, { x: outW, y: outH }, { x: 0, y: outH }], q);
  const { data, width, height } = src;
  const out = new Uint8ClampedArray(outW * outH * 4);
  for (let v = 0; v < outH; v++) {
    for (let u = 0; u < outW; u++) {
      const d = H[6] * u + H[7] * v + 1;
      const x = (H[0] * u + H[1] * v + H[2]) / d;
      const y = (H[3] * u + H[4] * v + H[5]) / d;
      const o = (v * outW + u) * 4;
      if (x < 0 || y < 0 || x >= width - 1 || y >= height - 1) {
        out[o] = out[o + 1] = out[o + 2] = 255; out[o + 3] = 255;
        continue;
      }
      const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
      const i00 = (y0 * width + x0) * 4, i10 = i00 + 4, i01 = i00 + width * 4, i11 = i01 + 4;
      for (let c = 0; c < 3; c++) {
        const top = data[i00 + c] * (1 - fx) + data[i10 + c] * fx;
        const bot = data[i01 + c] * (1 - fx) + data[i11 + c] * fx;
        out[o + c] = top * (1 - fy) + bot * fy;
      }
      out[o + 3] = 255;
    }
  }
  return { data: out, width: outW, height: outH };
}

/* Turn an image 180° (card photographed upside down). */
export function rotate180(img) {
  const { data, width, height } = img;
  const out = new Uint8ClampedArray(data.length);
  const n = width * height;
  for (let i = 0; i < n; i++) {
    const s = i * 4, d = (n - 1 - i) * 4;
    out[d] = data[s]; out[d + 1] = data[s + 1]; out[d + 2] = data[s + 2]; out[d + 3] = data[s + 3];
  }
  return { data: out, width, height };
}

/* ── Quality check ─────────────────────────────────────────────────────── */
/**
 * @returns { sharpness, brightness, glare, problem: null | "blurry" | "dark" | "glare" }
 * Measured on the flattened card (≈ 500 px wide is enough).
 */
export function quality(img) {
  const { width: w, height: h } = img;
  const g = toGray(img);
  let sum = 0, sum2 = 0, n = 0, bright = 0, total = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = g[i - 1] + g[i + 1] + g[i - w] + g[i + w] - 4 * g[i];
      sum += lap; sum2 += lap * lap; n++;
    }
  }
  for (let i = 0; i < g.length; i++) { total += g[i]; if (g[i] >= 250) bright++; }
  const sharpness = sum2 / n - (sum / n) ** 2;
  const brightness = total / g.length;
  const glare = bright / g.length;
  let problem = null;
  if (brightness < 70) problem = "dark";
  else if (glare > 0.12) problem = "glare";
  else if (sharpness < 25) problem = "blurry";
  return { sharpness, brightness, glare, problem };
}

/* ── Xerox look ────────────────────────────────────────────────────────── */
function percentile(values, p) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < values.length; i++) hist[values[i] < 0 ? 0 : values[i] > 255 ? 255 : values[i] | 0]++;
  let need = values.length * p, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= need) return v; }
  return 255;
}

/**
 * Evens out the light (a shadow over half the card) and stretches the contrast,
 * without washing out the photo or dark bands on the card. mode "bw" → grey,
 * like a photocopy; "color" → colour.
 * Light is estimated from the brightest paper in each block of the card (90th
 * percentile, widened to its neighbours), so dark printed areas don't count as
 * shadow; the correction is capped at 1.8×.
 */
export function enhance(img, mode = "bw") {
  const { data, width: w, height: h } = img;
  const g = toGray(img);
  const white = Math.max(60, percentile(g, 0.95));

  // brightest paper per block
  const bs = Math.max(16, Math.round(w / 12));
  const gw = Math.ceil(w / bs), gh = Math.ceil(h / bs);
  const grid = new Float32Array(gw * gh);
  for (let by = 0; by < gh; by++) {
    for (let bx = 0; bx < gw; bx++) {
      const vals = [];
      for (let y = by * bs; y < Math.min(h, (by + 1) * bs); y += 2)
        for (let x = bx * bs; x < Math.min(w, (bx + 1) * bs); x += 2) vals.push(g[y * w + x]);
      grid[by * gw + bx] = percentile(vals, 0.9);
    }
  }
  const lit = new Float32Array(gw * gh);
  for (let by = 0; by < gh; by++) {
    for (let bx = 0; bx < gw; bx++) {
      let m = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = by + dy, xx = bx + dx;
        if (yy >= 0 && yy < gh && xx >= 0 && xx < gw) m = Math.max(m, grid[yy * gw + xx]);
      }
      lit[by * gw + bx] = Math.max(m, white * 0.55);
    }
  }
  const lightAt = (x, y) => {
    const fx = Math.min(gw - 1, Math.max(0, x / bs - 0.5)), fy = Math.min(gh - 1, Math.max(0, y / bs - 0.5));
    const x0 = fx | 0, y0 = fy | 0, x1 = Math.min(gw - 1, x0 + 1), y1 = Math.min(gh - 1, y0 + 1);
    const ax = fx - x0, ay = fy - y0;
    const t = lit[y0 * gw + x0] * (1 - ax) + lit[y0 * gw + x1] * ax;
    const b = lit[y1 * gw + x0] * (1 - ax) + lit[y1 * gw + x1] * ax;
    return t * (1 - ay) + b * ay;
  };

  const corrected = new Float32Array(g.length);
  const kAt = new Float32Array(g.length);
  for (let y = 0, j = 0; y < h; y++) {
    for (let x = 0; x < w; x++, j++) {
      const k = Math.min(1.8, Math.max(1, white / lightAt(x, y)));
      kAt[j] = k;
      corrected[j] = g[j] * k;
    }
  }
  const lo = percentile(corrected, 0.02);
  const hi = Math.max(lo + 40, Math.min(255, white * 1.02));
  const scale = 255 / (hi - lo);
  const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
  const out = new Uint8ClampedArray(data.length);
  for (let j = 0, i = 0; j < g.length; j++, i += 4) {
    if (mode === "bw") {
      out[i] = out[i + 1] = out[i + 2] = clamp((corrected[j] - lo) * scale);
    } else {
      for (let c = 0; c < 3; c++) out[i + c] = clamp((data[i + c] * kAt[j] - lo) * scale);
    }
    out[i + 3] = 255;
  }
  return { data: out, width: w, height: h };
}
