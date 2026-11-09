// src/controllers/device.controller.js
// Registering a NEW device (Raspberry Pi kiosk or shop computer) with a
// one-time setup code from the admin panel.
//
//   Admin: Machines → Create machine (or "New setup code")  → shows e.g. "K7PD-3MXQ"
//   Device: POST /api/devices/register { setupCode, deviceName }
//         → { MACHINE_ID, API_KEY, API_BASE, MODULE }   (API key shown only this once)
//
// The code works once and expires after 48 hours. Registering again with a new
// code replaces the old key (e.g. when the shop gets a new computer).
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const db = require("../database/db");
const env = require("../config/env");
const { hashSetupCode } = require("../services/machine.service");
const { logAudit } = require("../services/audit.service");

exports.register = async (req, res) => {
  try {
    const { setupCode, deviceName } = req.body || {};
    if (!setupCode || typeof setupCode !== "string") return res.status(400).json({ error: "setupCode is required" });

    const [[machine]] = await db.query(
      `SELECT * FROM machines WHERE setup_code_hash=? AND setup_code_expires_at > NOW()`,
      [hashSetupCode(setupCode)]
    );
    if (!machine) return res.status(403).json({ error: "Setup code is wrong or has expired. Ask the admin for a new one." });
    if (machine.status === "DISABLED") return res.status(403).json({ error: "This machine is disabled" });

    const apiKey = crypto.randomBytes(32).toString("hex");
    await db.query(
      `UPDATE machines
       SET api_key_hash=?, setup_code_hash=NULL, setup_code_expires_at=NULL,
           status='ACTIVE', assigned=TRUE, device_name=?, last_seen_at=NOW(), last_ip=?
       WHERE id=?`,
      [await bcrypt.hash(apiKey, 10), deviceName ? String(deviceName).slice(0, 150) : null, req.ip, machine.id]
    );
    await logAudit(machine.machine_id, null, "MACHINE_API_KEY_ROTATED", { via: "setup_code", deviceName: deviceName || null }, { type: "DEVICE", ip: req.ip });
    console.log(`✅ Device registered for ${machine.machine_id} (${machine.module})`);

    res.json({
      MACHINE_ID: machine.machine_id,
      API_KEY: apiKey,
      API_BASE: env.API_BASE_URL,
      MODULE: machine.module,
    });
  } catch (err) {
    console.error("DEVICE REGISTER ERROR:", err);
    res.status(500).json({ error: "Registration failed" });
  }
};
