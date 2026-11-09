// src/routes/localStorage.routes.js — ONLY used when STORAGE_DRIVER=local (laptop testing).
// Plays the part of Cloudflare R2: accepts the signed PUT from the phone and
// serves the signed GET to the kiosk / shop computer.
const express = require("express");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const storage = require("../services/storage.service");
const { MAX_FILE_SIZE } = require("../config/fileTypes");

const router = express.Router();
const { verifyLocalSignature, localPath } = storage._local;

router.put(
  "/put",
  express.raw({ type: () => true, limit: MAX_FILE_SIZE + 1024 }),
  async (req, res) => {
    const { key, exp, sig } = req.query;
    if (!verifyLocalSignature("put", key, exp, sig)) return res.status(403).json({ error: "Link expired or invalid" });
    try {
      const p = localPath(key);
      await fsp.mkdir(path.dirname(p), { recursive: true });
      await fsp.writeFile(p, req.body && req.body.length ? req.body : Buffer.alloc(0));
      res.status(200).end();
    } catch (err) {
      console.error("LOCAL PUT ERROR:", err.message);
      res.status(500).json({ error: "Could not save file" });
    }
  }
);

router.get("/get", (req, res) => {
  const { key, exp, sig, name } = req.query;
  if (!verifyLocalSignature("get", key, exp, sig)) return res.status(403).json({ error: "Link expired or invalid" });
  let p;
  try {
    p = localPath(key);
  } catch {
    return res.status(400).json({ error: "Bad key" });
  }
  if (!fs.existsSync(p)) return res.status(404).json({ error: "File not found" });
  res.download(p, String(name || path.basename(p)));
});

module.exports = router;
