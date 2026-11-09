// src/socket/socket.js
// Socket.io setup.
//  - Dashboards/browsers get general events (machine_update, job_created, job_printed)
//    — these never contain file paths.
//  - Each kiosk can join its own private room "machine:<id>" by emitting
//    "kiosk:join" with the same signed credentials it uses for HTTP:
//      socket.emit("kiosk:join", { machineId, timestamp, apiKey, signature }, ack)
//    where signature = HMAC-SHA256(apiKey, machineId + timestamp + "{}").
//    Payment notifications for that kiosk go only to that room.
const { Server } = require("socket.io");
const { isAllowedOrigin } = require("../config/cors");
const { checkMachineCredentials } = require("../middleware/verifyMachine");

let io = null;

function initSocket(server) {
  io = new Server(server, {
    cors: {
      origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    // "kiosk:join" (Pi, Module 1) and "device:join" (shop computer, Module 2) are the same
    const join = async (payload = {}, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      try {
        const result = await checkMachineCredentials({ ...payload, body: {} });
        if (result.error) return reply({ ok: false, error: result.error });
        socket.join(machineRoom(result.machine.machine_id));
        reply({ ok: true });
      } catch (err) {
        console.error("KIOSK JOIN ERROR:", err.message);
        reply({ ok: false, error: "Join failed" });
      }
    };
    socket.on("kiosk:join", join);
    socket.on("device:join", join);
  });

  console.log("✅ Socket.io initialized");
  return io;
}

function machineRoom(machineId) {
  return `machine:${machineId}`;
}

// Safe getter — no-op emitter if sockets aren't up (e.g. in scripts/tests)
function getIO() {
  if (!io) {
    const noop = { emit: () => {} };
    return { emit: () => {}, to: () => noop };
  }
  return io;
}

module.exports = { initSocket, getIO, machineRoom };
