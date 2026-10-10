const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("measure", {
  phase: (name, samples) => ipcRenderer.send("measure:phase", name, samples),
  done: (info) => ipcRenderer.send("measure:done", info),
  fail: (message) => ipcRenderer.send("measure:fail", message)
});
