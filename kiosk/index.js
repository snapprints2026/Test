// index.js — Electron main process.
// The kiosk logic (kioskCore) runs ONLY here. The screen talks to it over
// IPC through preload.js, so there is exactly one copy of the kiosk running.
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");

// Low-end hardware (Raspberry Pi): software rendering is more stable.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-compositing");
// Let videos/animations play without a click first.
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

// Only one kiosk app at a time.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const kiosk = require("./kioskCore");
  let win = null;

  ipcMain.handle("kiosk:input",  (_event, input) => kiosk.handleInput(input));
  ipcMain.handle("kiosk:status", () => kiosk.getStatus());
  // Photocopy / scan orders: the screen shows the steps and calls these
  ipcMain.handle("kiosk:manual", () => kiosk.getManualJob());
  ipcMain.handle("kiosk:manual-action", (_event, action) => kiosk.manualAction(action));

  function createWindow() {
    win = new BrowserWindow({
      width: 800,
      height: 480,
      kiosk: true,              // fullscreen, no window controls
      autoHideMenuBar: true,
      backgroundColor: "#000000",
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,          // preload only uses ipcRenderer now
      },
    });

    win.loadFile("index.html");

    // Screen crashed or froze → rebuild the window (the kiosk logic keeps running).
    win.webContents.on("render-process-gone", (_e, details) => {
      console.error("🖥  Screen process gone:", details.reason, "— reloading window");
      try { win.destroy(); } catch {}
      setTimeout(createWindow, 1000);
    });
    win.on("unresponsive", () => {
      console.error("🖥  Screen unresponsive — reloading");
      win.webContents.reload();
    });

    // Never let a link open a new window or navigate away from the kiosk screen.
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (e) => e.preventDefault());
  }

  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();
    kiosk.start().catch((err) => console.error("Kiosk start error:", err));
  });

  app.on("window-all-closed", () => app.quit());
}
