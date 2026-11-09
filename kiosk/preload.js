// preload.js — the only bridge between the kiosk screen and the main process.
// It does NOT load kioskCore (that would start a second kiosk); it just
// forwards calls over IPC to index.js.
const { contextBridge, ipcRenderer } = require("electron");

const sendOtp = (input) => ipcRenderer.invoke("kiosk:input", input);

contextBridge.exposeInMainWorld("kioskAPI", {
  sendOtp,
  handleInput: sendOtp, // used by abc.html
  getStatus: () => ipcRenderer.invoke("kiosk:status"),
  getManualJob: () => ipcRenderer.invoke("kiosk:manual"),
  manualAction: (action) => ipcRenderer.invoke("kiosk:manual-action", action),
});
