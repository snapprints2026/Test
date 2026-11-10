// src/database/db.config.js — connection settings shared by the app and scripts.
// Reads DB_* (local) or Railway's MYSQL* variables.
//   DB_SSL=true   → encrypted connection
//   DB_SSL=false  → plain connection
// If DB_SSL is not set: SSL is used for every remote host (same as before, so
// Railway keeps working) and switched off for localhost (your laptop's MySQL).
function dbConfig() {
  const host = process.env.DB_HOST || process.env.MYSQLHOST || "localhost";
  const sslSetting = process.env.DB_SSL;
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(host);
  const useSsl = sslSetting ? sslSetting === "true" : !isLocal;
  return {
    host,
    user: process.env.DB_USER || process.env.MYSQLUSER || "root",
    password: process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || "",
    database: process.env.DB_NAME || process.env.MYSQLDATABASE || process.env.MYSQL_DATABASE || "railway",
    port: parseInt(process.env.DB_PORT || process.env.MYSQLPORT || "3306", 10),
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    // Store and read every DATETIME as UTC, whatever time zone the MySQL server
    // or this computer uses — otherwise "online in the last 2 minutes" breaks
    // when they differ (e.g. MySQL in UTC, laptop in IST).
    timezone: "Z",
    // DATE columns (contract dates, invoice periods, report months) come back
    // as "YYYY-MM-DD" strings instead of midnight-UTC Date objects.
    dateStrings: ["DATE"],
  };
}

module.exports = { dbConfig };
