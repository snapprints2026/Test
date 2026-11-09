require("../config/env"); // make sure .env is loaded first
const mysql = require("mysql2/promise");
const { dbConfig } = require("./db.config");

const db = mysql.createPool({
  ...dbConfig(),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Every connection works in UTC (matches timezone: "Z" above)
db.pool.on("connection", (conn) => conn.query("SET time_zone = '+00:00'"));

// Test connection (non-blocking)
(async () => {
  try {
    const conn = await db.getConnection();
    const [[row]] = await conn.query("SELECT DATABASE() AS current_db");
    console.log(`✅ DB Connected (${row.current_db})`);
    conn.release();
  } catch (err) {
    console.error("❌ DB Connection Failed:", err.message);
  }
})();

module.exports = db;
