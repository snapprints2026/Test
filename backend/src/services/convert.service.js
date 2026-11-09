// src/services/convert.service.js
// Turns every upload into a PDF, so that:
//   - pages are counted correctly (a 12-page Word file is priced as 12 pages, not 1)
//   - the kiosk / shop computer only ever has to print PDFs
//
//   PDF                         → kept as is
//   JPG / PNG                   → one A4 page per image (pdf-lib)
//   GIF / BMP / WEBP / TIFF     → converted to PNG first (sharp), then as above
//   TXT                         → LibreOffice if installed, else simple text layout
//   DOC / DOCX                  → LibreOffice (headless). Without it: null (not converted)
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { PDFDocument, StandardFonts } = require("pdf-lib");
const env = require("../config/env");

const A4 = [595.28, 841.89]; // points
const MARGIN = 24;

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tif", ".tiff"]);
const OFFICE_EXTS = new Set([".doc", ".docx"]);

let libreOfficeAvailable = null; // checked once

function run(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        return reject(err);
      }
      resolve(stdout);
    });
  });
}

async function hasLibreOffice() {
  if (libreOfficeAvailable !== null) return libreOfficeAvailable;
  try {
    await run(env.LIBREOFFICE_PATH, ["--version"], 20000);
    libreOfficeAvailable = true;
  } catch {
    libreOfficeAvailable = false;
    console.warn("⚠️  LibreOffice not found — Word files will not be converted to PDF (priced as 1 page).");
  }
  return libreOfficeAvailable;
}

/* LibreOffice is heavy: at most 2 conversions at once on a small server,
   the rest wait their turn (from the live code). */
const MAX_PARALLEL = 2;
let running = 0;
const waiting = [];
async function withSlot(fn) {
  if (running >= MAX_PARALLEL) await new Promise((resolve) => waiting.push(resolve));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    const next = waiting.shift();
    if (next) next();
  }
}

function libreOfficeToPdf(buffer, ext) {
  return withSlot(() => libreOfficeToPdfNow(buffer, ext));
}

async function libreOfficeToPdfNow(buffer, ext) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "sp-convert-"));
  try {
    const input = path.join(dir, `input${ext}`);
    await fsp.writeFile(input, buffer);
    // Separate profile per conversion so parallel uploads don't block each other.
    const profile = "file://" + path.join(dir, "profile").replace(/\\/g, "/");
    const args = [`-env:UserInstallation=${profile}`, "--headless", "--norestore", "--nolockcheck"];
    if (ext === ".txt") args.push("--infilter=Text (encoded):UTF8,LF,,,"); // Hindi, Marathi, ₹
    args.push("--convert-to", "pdf", "--outdir", dir, input);
    await run(env.LIBREOFFICE_PATH, args, 120000);
    return await fsp.readFile(path.join(dir, "input.pdf"));
  } finally {
    fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function imageToPdf(buffer, ext) {
  const pdf = await PDFDocument.create();
  let image;
  if (ext === ".jpg" || ext === ".jpeg") {
    image = await pdf.embedJpg(buffer);
  } else if (ext === ".png") {
    image = await pdf.embedPng(buffer);
  } else {
    const sharp = require("sharp");
    // first frame only for animated GIF / multi-page TIFF
    const png = await sharp(buffer, { animated: false }).rotate().png().toBuffer();
    image = await pdf.embedPng(png);
  }
  // Landscape page for wide images, portrait otherwise; image scaled to fit inside the margins.
  const landscape = image.width > image.height;
  const [pw, ph] = landscape ? [A4[1], A4[0]] : A4;
  const scale = Math.min((pw - 2 * MARGIN) / image.width, (ph - 2 * MARGIN) / image.height, 1e9);
  const w = image.width * scale;
  const h = image.height * scale;
  const page = pdf.addPage([pw, ph]);
  page.drawImage(image, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  return Buffer.from(await pdf.save());
}

async function textToPdf(buffer) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Courier);
  const size = 10;
  const lineHeight = 12;
  const maxChars = Math.floor((A4[0] - 2 * 40) / font.widthOfTextAtSize("M", size));
  // Standard PDF fonts only cover Western characters; anything else becomes "?".
  const text = buffer.toString("utf8").replace(/\r\n?/g, "\n").replace(/\t/g, "    ")
    .replace(/[^\n\x20-\x7E -ÿ]/g, "?");
  const lines = [];
  for (const raw of text.split("\n")) {
    if (!raw.length) { lines.push(""); continue; }
    for (let i = 0; i < raw.length; i += maxChars) lines.push(raw.slice(i, i + maxChars));
  }
  const perPage = Math.floor((A4[1] - 2 * 40) / lineHeight);
  for (let i = 0; i < Math.max(lines.length, 1); i += perPage) {
    const page = pdf.addPage(A4);
    lines.slice(i, i + perPage).forEach((line, n) => {
      page.drawText(line, { x: 40, y: A4[1] - 40 - (n + 1) * lineHeight, size, font });
    });
  }
  return Buffer.from(await pdf.save());
}

/**
 * @returns {Promise<Buffer|null>} PDF bytes, or null if this file can't be converted here.
 * Throws if the file is damaged.
 */
async function convertToPdf(buffer, ext) {
  ext = ext.toLowerCase();
  if (ext === ".pdf") return buffer;
  if (IMAGE_EXTS.has(ext)) return imageToPdf(buffer, ext);
  if (ext === ".txt") return (await hasLibreOffice()) ? libreOfficeToPdf(buffer, ext) : textToPdf(buffer);
  if (OFFICE_EXTS.has(ext)) return (await hasLibreOffice()) ? libreOfficeToPdf(buffer, ext) : null;
  return null;
}

const randomName = () => crypto.randomBytes(16).toString("hex");

module.exports = { convertToPdf, hasLibreOffice, randomName };
