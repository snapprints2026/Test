// scripts/migrate.js — create / upgrade the database.
//
//   npm run migrate                    safe to run any time (Railway pre-deploy)
//   npm run migrate -- --drop-legacy   once, AFTER the new version is live:
//                                      physically removes the old plain-text
//                                      columns (customers.otp, print_job_tokens.otp
//                                      / qr_token, machines.api_key_plain)
//
// 1. Runs database/schema.sql (every table is CREATE TABLE IF NOT EXISTS,
//    so a brand-new database gets everything).
// 2. Upgrades an OLDER database: adds missing columns / indexes / foreign
//    keys, turns audit_logs.action_type into free text, hashes stored OTPs,
//    clears plain API keys and masks UPI IDs in payment details.
//    Existing orders, revenue and machines are kept; every existing machine
//    keeps its module, and existing admins become SUPER_ADMIN.
const env = require("../src/config/env");
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { dbConfig } = require("../src/database/db.config");
const { hashSecret, encryptString } = require("../src/services/crypto.service");

const DROP_LEGACY = process.argv.includes("--drop-legacy");

// [table, column, full column definition]
const COLUMNS = [
  // admin roles
  ["admin_users", "role",            "ENUM('SUPER_ADMIN','ADMIN','FINANCE','SUPPORT') NOT NULL DEFAULT 'ADMIN'"],
  ["admin_users", "last_login_at",   "DATETIME NULL"],
  // vendors
  ["vendors",    "allowed_modules",       "VARCHAR(20) NOT NULL DEFAULT 'KIOSK'"],
  ["vendors",    "address",               "VARCHAR(500) NULL"],
  ["vendors",    "state",                 "VARCHAR(100) NULL"],
  ["vendors",    "segment",               "ENUM('EDUCATION','RETAIL','GOVERNMENT','PSU') NOT NULL DEFAULT 'EDUCATION'"],
  ["vendors",    "strict_privacy",        "TINYINT(1) NULL"],
  ["vendors",    "institution_type",      "VARCHAR(30) NOT NULL DEFAULT 'COLLEGE'"],
  ["vendors",    "contact_designation",   "VARCHAR(100) NULL"],
  ["vendors",    "alt_phone",             "VARCHAR(20) NULL"],
  ["vendors",    "pan_number",            "VARCHAR(10) NULL"],
  ["vendors",    "billing_address",       "VARCHAR(500) NULL"],
  // customers
  ["customers",  "otp_hash",              "VARCHAR(64) NULL"],
  ["customers",  "otp_attempts",          "TINYINT UNSIGNED NOT NULL DEFAULT 0"],
  ["customers",  "deleted_at",            "DATETIME NULL"],
  // locations (office hours for SLA)
  ["locations",  "open_time",             "TIME NULL"],
  ["locations",  "close_time",            "TIME NULL"],
  ["locations",  "open_days",             "VARCHAR(20) NULL"],
  ["locations",  "weekly_off",            "VARCHAR(30) NULL"],
  ["locations",  "campus_name",           "VARCHAR(150) NULL"],
  ["locations",  "building",              "VARCHAR(100) NULL"],
  ["locations",  "floor",                 "VARCHAR(50) NULL"],
  ["locations",  "spot",                  "VARCHAR(150) NULL"],
  ["locations",  "landmark",              "VARCHAR(200) NULL"],
  ["locations",  "contact_name",          "VARCHAR(120) NULL"],
  ["locations",  "contact_phone",         "VARCHAR(20) NULL"],
  ["locations",  "state",                 "VARCHAR(100) NULL"],
  ["locations",  "pincode",               "VARCHAR(10) NULL"],
  ["locations",  "latitude",              "DECIMAL(10,7) NULL"],
  ["locations",  "longitude",             "DECIMAL(10,7) NULL"],
  // machines
  ["machines",   "module",                "ENUM('KIOSK','SHOP') NOT NULL DEFAULT 'KIOSK'"],
  ["machines",   "require_login",         "TINYINT(1) NULL"],
  ["machines",   "device_name",           "VARCHAR(150) NULL"],
  ["machines",   "setup_code_hash",       "VARCHAR(64) NULL"],
  ["machines",   "setup_code_expires_at", "DATETIME NULL"],
  ["machines",   "organization_id",       "INT UNSIGNED NULL"],
  ["machines",   "contract_id",           "INT UNSIGNED NULL"],
  ["machines",   "enabled_job_types",     "VARCHAR(40) NOT NULL DEFAULT 'PRINT,FORM'"],
  ["machines",   "billing_mode",          "ENUM('CUSTOMER','DEPARTMENT') NOT NULL DEFAULT 'CUSTOMER'"],
  ["machines",   "staff_pin_hash",        "VARCHAR(255) NULL"],
  ["machines",   "default_language",      "ENUM('en','hi','mr') NULL"],
  ["machines",   "asset_tag",             "VARCHAR(60) NULL"],
  ["machines",   "printer_model",         "VARCHAR(120) NULL"],
  ["machines",   "installed_at",          "DATE NULL"],
  // print_jobs
  ["print_jobs", "printer_id",            "INT UNSIGNED NULL"],
  ["print_jobs", "order_code",            "VARCHAR(8) NULL"],
  ["print_jobs", "fail_reason",           "VARCHAR(255) NULL"],
  ["print_jobs", "organization_id",       "INT UNSIGNED NULL"],
  ["print_jobs", "contract_id",           "INT UNSIGNED NULL"],
  ["print_jobs", "job_type",              "ENUM('PRINT','COPY','SCAN','FORM') NOT NULL DEFAULT 'PRINT'"],
  ["print_jobs", "form_template_id",      "INT UNSIGNED NULL"],
  ["print_jobs", "billing",               "ENUM('CUSTOMER','DEPARTMENT') NOT NULL DEFAULT 'CUSTOMER'"],
  ["print_jobs", "file_encrypted",        "TINYINT(1) NOT NULL DEFAULT 0"],
  ["print_jobs", "file_deleted_at",       "DATETIME NULL"],
  ["print_jobs", "result_path",           "VARCHAR(512) NULL"],
  ["print_jobs", "result_expires_at",     "DATETIME NULL"],
  ["print_jobs", "unit_rate",             "DECIMAL(8,2) NULL"],
  ["print_jobs", "pricing_rule_id",       "INT UNSIGNED NULL"],
  // support & refunds (reference code, UPI reference, refund tracking)
  ["print_jobs", "ref_code",              "VARCHAR(12) NULL"],
  ["print_jobs", "utr",                   "VARCHAR(40) NULL"],
  ["print_jobs", "payer_contact",         "VARCHAR(15) NULL"],
  ["print_jobs", "refund_id",             "VARCHAR(64) NULL"],
  ["print_jobs", "refund_amount",         "DECIMAL(10,2) NULL"],
  ["print_jobs", "refund_status",         "VARCHAR(12) NULL"],
  ["print_jobs", "refund_reason",         "VARCHAR(255) NULL"],
  ["print_jobs", "refunded_at",           "DATETIME NULL"],
  ["print_jobs", "source",                "VARCHAR(10) NULL"],
  // kiosk tokens: hashed + encrypted
  ["print_job_tokens", "otp_hash",        "VARCHAR(64) NULL"],
  ["print_job_tokens", "otp_enc",         "VARCHAR(255) NULL"],
  ["print_job_tokens", "qr_hash",         "VARCHAR(64) NULL"],
  ["print_job_tokens", "qr_enc",          "VARCHAR(255) NULL"],
  // hardware sensors
  ["machine_heartbeat_logs", "power_source",    "VARCHAR(10) NULL"],
  ["machine_heartbeat_logs", "ups_battery_pct", "INT NULL"],
  ["machine_heartbeat_logs", "door_open",       "TINYINT(1) NULL"],
  // audit actors
  ["audit_logs", "actor_type",            "ENUM('ADMIN','VENDOR','OFFICER','DEVICE','SYSTEM','CUSTOMER') NOT NULL DEFAULT 'SYSTEM'"],
  ["audit_logs", "actor_id",              "INT UNSIGNED NULL"],
  ["audit_logs", "ip",                    "VARCHAR(64) NULL"],
];

// [table, index name, columns]
const INDEXES = [
  ["machines",   "idx_machines_setup_code",     "(setup_code_hash)"],
  ["machines",   "idx_machines_org",            "(organization_id)"],
  ["machines",   "idx_machines_contract",       "(contract_id)"],
  ["vendors",    "idx_vendors_segment",         "(segment)"],
  ["print_jobs", "idx_print_jobs_order_code",   "(machine_id, order_code)"],
  ["print_jobs", "idx_print_jobs_printer",      "(printer_id)"],
  ["print_jobs", "idx_print_jobs_org_created",  "(organization_id, created_at)"],
  ["print_jobs", "idx_print_jobs_contract",     "(contract_id, status, created_at)"],
  ["print_jobs", "idx_print_jobs_result",       "(result_expires_at)"],
  ["print_jobs", "uq_print_jobs_ref_code",      "(ref_code)", "UNIQUE"],
  ["print_jobs", "idx_print_jobs_utr",          "(utr)"],
  ["print_jobs", "idx_print_jobs_payer",        "(payer_contact)"],
  ["print_jobs", "idx_print_jobs_refund",       "(refund_status)"],
  ["print_job_tokens", "idx_pjt_otp_hash",      "(otp_hash)"],
  ["print_job_tokens", "idx_pjt_qr_hash",       "(qr_hash)"],
  ["audit_logs", "idx_audit_actor",             "(actor_type, actor_id)"],
  ["audit_logs", "idx_audit_created",           "(created_at)"],
];

// [table, constraint name, definition]
const FOREIGN_KEYS = [
  ["machines", "fk_machines_org",
    "FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE"],
  ["machines", "fk_machines_contract",
    "FOREIGN KEY (contract_id) REFERENCES contracts (id) ON DELETE SET NULL ON UPDATE CASCADE"],
];

// Old plain-text columns: emptied on every run, dropped with --drop-legacy.
const LEGACY_COLUMNS = [
  ["customers", "otp"],
  ["print_job_tokens", "otp"],
  ["print_job_tokens", "qr_token"],
  ["machines", "api_key_plain"],
];

async function run() {
  const conn = await mysql.createConnection({ ...dbConfig(), multipleStatements: true });
  const [[{ db }]] = await conn.query("SELECT DATABASE() AS db");
  if (!db) throw new Error("No database selected — set DB_NAME in backend/.env");
  console.log(`Migrating database "${db}"...`);

  const columnInfo = async (table, column) => {
    const [rows] = await conn.query(
      `SELECT DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH
       FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?`,
      [db, table, column]
    );
    return rows[0] || null;
  };

  const schema = fs.readFileSync(path.join(__dirname, "../database/schema.sql"), "utf8");
  await conn.query(schema);
  console.log("✓ tables checked / created");

  /* ── 1. missing columns ── */
  const added = new Set();
  for (const [table, column, def] of COLUMNS) {
    if (!(await columnInfo(table, column))) {
      await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${def}`);
      added.add(`${table}.${column}`);
      console.log(`✓ added ${table}.${column}`);
    }
  }

  // Admins that existed before roles keep full access.
  if (added.has("admin_users.role")) {
    await conn.query(`UPDATE admin_users SET role='SUPER_ADMIN'`);
    console.log("✓ existing admins are SUPER_ADMIN");
  }

  /* ── 2. column type changes ── */
  const action = await columnInfo("audit_logs", "action_type");
  if (action && action.DATA_TYPE === "enum") {
    await conn.query(`ALTER TABLE audit_logs MODIFY action_type VARCHAR(50) NOT NULL DEFAULT 'OTHER'`);
    console.log("✓ audit_logs.action_type is now free text");
  }
  // Older live databases may have institution_type as an ENUM without the government / bank values.
  const inst = await columnInfo("vendors", "institution_type");
  if (inst && inst.DATA_TYPE === "enum") {
    await conn.query(`ALTER TABLE vendors MODIFY institution_type VARCHAR(30) NOT NULL DEFAULT 'COLLEGE'`);
    console.log("✓ vendors.institution_type is now free text");
  }
  for (const col of ["refund_status"]) {
    const ci = await columnInfo("print_jobs", col);
    if (ci && ci.DATA_TYPE === "enum") await conn.query(`ALTER TABLE print_jobs MODIFY ${col} VARCHAR(12) NULL`);
  }
  // open_days (used for uptime) from weekly_off (set in the old dashboard)
  if (await columnInfo("locations", "weekly_off")) {
    const [locs] = await conn.query(`SELECT id, weekly_off FROM locations WHERE open_days IS NULL AND open_time IS NOT NULL`);
    const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
    for (const l of locs) {
      const off = new Set(String(l.weekly_off || "").split(",").filter(Boolean));
      const on = DAYS.map((d, i) => (off.has(d) ? null : i + 1)).filter(Boolean).join(",");
      await conn.query(`UPDATE locations SET open_days=? WHERE id=?`, [on || null, l.id]);
    }
    if (locs.length) console.log(`✓ office days set for ${locs.length} location(s)`);
  }
  const fp = await columnInfo("print_jobs", "file_path");
  if (fp && fp.IS_NULLABLE === "NO") {
    await conn.query(`ALTER TABLE print_jobs MODIFY file_path VARCHAR(512) NULL`);
    console.log("✓ print_jobs.file_path can now be empty");
  }
  const phone = await columnInfo("customers", "phone");
  if (phone && Number(phone.CHARACTER_MAXIMUM_LENGTH) < 20) {
    await conn.query(`ALTER TABLE customers MODIFY phone VARCHAR(20) NOT NULL`);
    console.log("✓ customers.phone widened");
  }
  const cname = await columnInfo("customers", "name");
  if (cname && cname.IS_NULLABLE === "NO") {
    await conn.query(`ALTER TABLE customers MODIFY name VARCHAR(120) NULL`);
    console.log("✓ customers.name can now be empty");
  }

  /* ── 3. data: no plain-text secrets ── */
  if (await columnInfo("print_job_tokens", "otp")) {
    const hasQr = !!(await columnInfo("print_job_tokens", "qr_token"));
    const [tokens] = await conn.query(
      `SELECT id, otp${hasQr ? ", qr_token" : ""} FROM print_job_tokens
       WHERE otp IS NOT NULL${hasQr ? " OR qr_token IS NOT NULL" : ""}`
    );
    for (const t of tokens) {
      await conn.query(
        `UPDATE print_job_tokens SET otp_hash=?, otp_enc=?, qr_hash=?, qr_enc=?,
           otp=NULL${hasQr ? ", qr_token=NULL" : ""} WHERE id=?`,
        [hashSecret(t.otp), encryptString(t.otp), hashSecret(t.qr_token), encryptString(t.qr_token), t.id]
      );
    }
    if (tokens.length) console.log(`✓ hashed ${tokens.length} kiosk OTP(s)`);
  }
  if (await columnInfo("customers", "otp")) {
    const [r] = await conn.query(`UPDATE customers SET otp=NULL WHERE otp IS NOT NULL`);
    if (r.affectedRows) console.log(`✓ cleared ${r.affectedRows} plain login OTP(s) (customers just request a new one)`);
  }
  if (await columnInfo("machines", "api_key_plain")) {
    const [r] = await conn.query(`UPDATE machines SET api_key_plain=NULL WHERE api_key_plain IS NOT NULL`);
    if (r.affectedRows) console.log(`✓ removed ${r.affectedRows} plain API key(s)`);
  }

  // Keep only what support needs from payment details: masked UPI ID.
  const [pays] = await conn.query(
    `SELECT id, payment_details FROM print_jobs
     WHERE payment_details IS NOT NULL AND JSON_EXTRACT(payment_details, '$.vpa') IS NOT NULL`
  );
  let masked = 0;
  for (const p of pays) {
    const d = typeof p.payment_details === "string" ? JSON.parse(p.payment_details) : p.payment_details;
    if (d && d.vpa && !String(d.vpa).includes("*")) {
      d.vpa = maskVpa(d.vpa);
      await conn.query(`UPDATE print_jobs SET payment_details=? WHERE id=?`, [JSON.stringify(d), p.id]);
      masked++;
    }
  }
  if (masked) console.log(`✓ masked ${masked} UPI ID(s) in payment details`);

  // Audit rows written by admins before actor_type existed
  await conn.query(
    `UPDATE audit_logs SET actor_type='ADMIN', actor_id=actor_admin_id
     WHERE actor_admin_id IS NOT NULL AND actor_id IS NULL`
  );
  // Files already gone on old rows
  await conn.query(
    `UPDATE print_jobs SET file_deleted_at=updated_at
     WHERE file_path IS NULL AND file_deleted_at IS NULL AND status IN ('PRINTED','FAILED','EXPIRED')`
  );

  /* ── 4. indexes ── */
  for (const [table, index, cols, kind] of INDEXES) {
    const [rows] = await conn.query(
      `SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND INDEX_NAME=?`,
      [db, table, index]
    );
    // A UNIQUE index the live database already has on the same column counts too.
    const [same] = kind === "UNIQUE"
      ? await conn.query(
          `SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=? AND NON_UNIQUE=0`,
          [db, table, cols.replace(/[()\s]/g, "")])
      : [[]];
    if (!rows.length && !same.length) {
      await conn.query(`ALTER TABLE \`${table}\` ADD ${kind === "UNIQUE" ? "UNIQUE " : ""}INDEX \`${index}\` ${cols}`);
      console.log(`✓ added index ${table}.${index}`);
    }
  }

  /* ── 5. foreign keys ── */
  for (const [table, name, def] of FOREIGN_KEYS) {
    const [rows] = await conn.query(
      `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
       WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND CONSTRAINT_NAME=? AND CONSTRAINT_TYPE='FOREIGN KEY'`,
      [db, table, name]
    );
    if (!rows.length) {
      await conn.query(`ALTER TABLE \`${table}\` ADD CONSTRAINT \`${name}\` ${def}`);
      console.log(`✓ added foreign key ${table}.${name}`);
    }
  }

  /* ── 6. optional: drop the old plain-text columns ── */
  const legacyLeft = [];
  for (const [table, column] of LEGACY_COLUMNS) {
    if (await columnInfo(table, column)) {
      if (DROP_LEGACY) {
        await conn.query(`ALTER TABLE \`${table}\` DROP COLUMN \`${column}\``);
        console.log(`✓ dropped ${table}.${column}`);
      } else {
        legacyLeft.push(`${table}.${column}`);
      }
    }
  }
  if (legacyLeft.length) {
    console.log(`ℹ old columns kept (empty, unused): ${legacyLeft.join(", ")}`);
    console.log("  After the new version is live, run:  npm run migrate -- --drop-legacy");
  }

  await conn.end();
  console.log(`✅ Database is up to date${env.IS_PROD ? "" : " (development)"}`);
}

function maskVpa(vpa) {
  const [user, handle] = String(vpa).split("@");
  const shown = (user || "").slice(0, 2);
  return `${shown}***${handle ? `@${handle}` : ""}`;
}

run().catch((err) => {
  console.error("❌ MIGRATION FAILED:", err.message);
  process.exit(1);
});
