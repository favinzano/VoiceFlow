const { contextBridge, ipcRenderer } = require("electron");

function readEncodedArgument(prefix) {
  const argument = process.argv.filter((value) => value.startsWith(prefix)).at(-1);
  if (!argument) throw new Error(`Missing required preload argument: ${prefix}`);
  return decodeURIComponent(argument.slice(prefix.length));
}

const rendererBrand = Object.freeze({
  displayName: readEncodedArgument("--voiceflow-brand-display-name="),
  baseName: readEncodedArgument("--voiceflow-brand-base-name="),
  suffix: readEncodedArgument("--voiceflow-brand-suffix="),
  copper: readEncodedArgument("--voiceflow-brand-copper=")
});
const appVersion = readEncodedArgument("--voiceflow-app-version=");
const runtimePlatform = readEncodedArgument("--voiceflow-platform=");
const runtimeCapabilities = Object.freeze(JSON.parse(readEncodedArgument("--voiceflow-capabilities=")));
const preserveLegacyStorageArgument = process.argv.filter((value) => value.startsWith("--voiceflow-preserve-legacy-storage=")).at(-1);
const rendererRuntime = Object.freeze({
  isPackaged: !process.defaultApp,
  platform: runtimePlatform,
  capabilities: runtimeCapabilities,
  preserveLegacyStorage: preserveLegacyStorageArgument === "--voiceflow-preserve-legacy-storage=1"
});

contextBridge.exposeInMainWorld("voiceAPI", {
  brand: rendererBrand,
  runtime: rendererRuntime,
  appVersion,
  copy: (text) => ipcRenderer.invoke("clipboard:write", text),
  paste: (text) => ipcRenderer.invoke("clipboard:paste", text),
  notifyPastePermissionDenied: () => ipcRenderer.invoke("paste:notify-permission-denied"),
  exportHistory: (entries) => ipcRenderer.invoke("history:export", entries),
  getState: () => ipcRenderer.invoke("state:get"),
  migrateLegacyState: (state) => ipcRenderer.invoke("state:migrate-legacy", state),
  writeState: (state) => ipcRenderer.invoke("state:write", state),
  transcriptions: {
    getAll: (limit) => ipcRenderer.invoke("transcriptions:get-all", limit),
    add: (texto, limit) => ipcRenderer.invoke("transcriptions:add", texto, limit),
    delete: (id) => ipcRenderer.invoke("transcriptions:delete", id),
    clear: () => ipcRenderer.invoke("transcriptions:clear"),
    trim: (limit) => ipcRenderer.invoke("transcriptions:trim", limit),
    migrateLegacy: (entries) => ipcRenderer.invoke("transcriptions:migrate-legacy", entries)
  },
  transcribe: (audio, language, profile, device) => ipcRenderer.invoke("transcription:run", audio, language, profile, device),
  transcription: {
    start: (configuration) => ipcRenderer.invoke("transcription:start", configuration),
    pushAudio: (sessionId, audio) => ipcRenderer.send("transcription:audio", sessionId, audio),
    finish: (sessionId) => ipcRenderer.invoke("transcription:finish", sessionId),
    cancel: (sessionId) => ipcRenderer.invoke("transcription:cancel", sessionId)
  },
  deliver: (text, options) => ipcRenderer.invoke("delivery:commit", text, options),
  metrics: {
    record: (metric) => ipcRenderer.invoke("metrics:record", metric),
    summary: () => ipcRenderer.invoke("metrics:summary")
  },
  overlay: (state) => ipcRenderer.invoke("overlay:set-state", state),
  sendAudioData: (frequencyData) => ipcRenderer.send("audio-data-update", frequencyData),
  taskbar: (state) => ipcRenderer.invoke("taskbar:set-state", state),
  diagnostics: () => ipcRenderer.invoke("app:diagnostics"),
  clearModels: () => ipcRenderer.invoke("models:clear"),
  repairModels: (profile, device) => ipcRenderer.invoke("models:repair", profile, device),
  modelPacks: {
    list: () => ipcRenderer.invoke("models:list-packs"),
    install: () => ipcRenderer.invoke("models:install-pack")
  },
  legal: {
    getStatus: () => ipcRenderer.invoke("legal:get-status"),
    acceptCurrentTerms: () => ipcRenderer.invoke("legal:accept-current-terms"),
    declineCurrentTerms: () => ipcRenderer.invoke("legal:decline-current-terms"),
    readDocument: (type, language) => ipcRenderer.invoke("legal:read-document", type, language),
    contact: () => ipcRenderer.invoke("legal:contact")
  },
  eraseLocalPersonalData: () => ipcRenderer.invoke("privacy:erase-local-personal-data"),
  getCloseBehavior: () => ipcRenderer.invoke("app:get-close-behavior"),
  setCloseBehavior: (behavior) => ipcRenderer.invoke("app:set-close-behavior", behavior),
  getAutoStart: () => ipcRenderer.invoke("preferences:get-autostart"),
  setAutoStart: (enabled) => ipcRenderer.invoke("preferences:set-autostart", enabled),
  getShortcuts: () => ipcRenderer.invoke("preferences:get-shortcuts"),
  setShortcuts: (shortcuts) => ipcRenderer.invoke("preferences:set-shortcuts", shortcuts),
  getShortcutMode: () => ipcRenderer.invoke("preferences:get-shortcut-mode"),
  setShortcutMode: (mode) => ipcRenderer.invoke("preferences:set-shortcut-mode", mode),
  minimize: () => ipcRenderer.invoke("window:minimize"),
  hide: () => ipcRenderer.invoke("window:hide"),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  onShortcutToggle: (callback) => ipcRenderer.on("shortcut:toggle", callback),
  onShortcutPressed: (callback) => ipcRenderer.on("shortcut:pressed", callback),
  onShortcutReleased: (callback) => ipcRenderer.on("shortcut:released", callback),
  onReprocess: (callback) => ipcRenderer.on("shortcut:reprocess", callback),
  onRecordingInterrupt: (callback) => ipcRenderer.on("recording:interrupt", callback),
  onShortcutError: (callback) => ipcRenderer.on("shortcut:error", callback),
  onModelProgress: (callback) => ipcRenderer.on("model:progress", (_event, progress) => callback(progress)),
  onNavigate: (callback) => ipcRenderer.on("app:navigate", (_event, panel) => callback(panel)),
  onPasteLast: (callback) => ipcRenderer.on("tray:paste-last", callback),
  onUpdateDownloaded: (callback) => ipcRenderer.on("update:downloaded", (_event, info) => callback(info))
});
