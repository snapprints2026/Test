// src/config.js — the agent's settings file (config.json next to package.json).
// Written by `npm run setup`. Contains the machine's API key: keep it private.
const fs = require("fs");
const path = require("path");

const CONFIG_PATH = process.env.SNAPPRINTS_AGENT_CONFIG || path.join(__dirname, "..", "config.json");

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return null;
  }
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

module.exports = { CONFIG_PATH, loadConfig, saveConfig };
