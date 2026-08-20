const { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeImage, session, screen, shell, Tray } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("fs/promises");
const fsSync = require("node:fs");
const path = require("path");
const { spawn } = require("child_process");
const brand = require("./brand-config.cjs");
const { migrateBrandData } = require("./brand-migration.cjs");
const { prepareBrandElectronPaths } = require("./brand-session-path.cjs");
const { resolveIsolatedAppPaths } = require('./self-test-paths.cjs');
const { disableLegacyLoginItems } = require('./login-item-transition.cjs');
const { configurePlatformAutoStart, getPlatformAutoStartEnabled, resolveAutoStartExecutablePath } = require('./auto-start.cjs');
const { resolvePlatformCapabilities } = require('./platform-capabilities.cjs');
const {
  CURRENT_TERMS_VERSION,
  DEFAULT_SHORTCUTS,
  acceptCurrentTerms,
  getAutoStartEnabled,
  getCloseBehavior,
  getLegalAcceptance,
  getShortcutMode,
  getShortcuts,
  hasAcceptedCurrentTerms,
  hasAutoStartPreference,
  setAutoStartEnabled,
  setCloseBehavior,
  setShortcutMode,
  setShortcuts
} = require("./app-preferences.cjs");
const { createInputStrategy, resolveWin32HelperPath, PASTE_FAILURE_REASON } = require("./input-helper.cjs");
const { notifyPastePermissionDenied } = require("./paste-permission-notice.cjs");
const { resolveWhisperProfile } = require("./whisper-profiles.cjs");
const { loadModelWithRetry } = require("./model-recovery.cjs");
const { createTranscriptionMetricsStore } = require("./transcription-metrics.cjs");
const { createTranscriptionService } = require("./transcription-service.cjs");
const { createModelPackManager } = require("./model-pack-manager.cjs");
const { createHistoryWriteQueue } = require("./history-write-queue.cjs");
const { migrateLegacyState, readState, STATE_SCHEMA_VERSION, statePath, writeState } = require("./local-state.cjs");
const { erasePersonalDataFiles } = require("./personal-data.cjs");
const {
  clearModelCache,
  directorySize,
  ensureModelCache,
  getModelCacheDir
} = require("./model-storage.cjs");
const {
  clearTranscriptions,
  closeDb,
  deleteTranscription,
  getAllTranscriptions,
  initDb,
  insertTranscription,
  migrateLegacyHistory,
  trimTranscriptions
} = require("./db.cjs");

let mainWindow;
let overlayWindow;
let transcriptionService;
let transcriptionMetricsStore;
let modelPackManager;
let historyWriteQueue;
let waitingForHistoryFlush = false;
let pasteTarget;
let shortcutRecording = false;
let tray;
let isQuitting = false;
let closeDialogOpen = false;
let manualUpdateCheck = false;
let activeShortcuts;
let shortcutRegistrationStatus = { record: false, reprocess: false };
let activeShortcutMode = "toggle";
const shortcutMonitors = new Map();
let requestedTaskbarState = "idle";
let modelDownloadActive = false;
let taskbarPulseTimer;
let taskbarIcons;
let brandMigration = { status: "pending" };
let bootstrapComplete = false;
let pendingShowMainWindow = false;
let acceptedRuntimeActive = false;
let startHidden = process.argv.includes("--hidden");
const isolatedPaths = resolveIsolatedAppPaths(process.argv);
const selfTestPaths = isolatedPaths?.mode === 'self-test' ? isolatedPaths : null;
const isolatedTestMode = Boolean(isolatedPaths);
const allowTestInstance = process.argv.includes("--allow-test-instance") || Boolean(selfTestPaths);

app.setName(brand.displayName);
if (process.platform === "win32") {
  // Chromium's GPU allowlist can reject DirectX 12 devices on some Windows
  // configurations (older drivers, hybrid GPUs); ignoring the blocklist here
  // only affects Chromium's own GPU process checks. onnxruntime-node's
  // DirectML execution provider initializes its own D3D12 device independently,
  // but keeping both GPU paths unblocked avoids inconsistent behavior on the
  // same machine.
  app.commandLine.appendSwitch("ignore-gpu-blocklist");
}
const appDataPath = app.getPath("appData");
const targetUserDataName = app.isPackaged ? brand.displayName : brand.developmentName;
const targetUserDataPath = isolatedPaths?.userData || path.join(appDataPath, targetUserDataName);
const legacyUserDataNames = isolatedPaths ? [] : brand.legacyDataNames.filter((name) => {
  return app.isPackaged ? !name.endsWith(" Development") : name.endsWith(" Development");
});
const legacyUserDataPaths = legacyUserDataNames.map((name) => path.join(appDataPath, name));
const preparedBrandPaths = isolatedPaths || prepareBrandElectronPaths({
  targetPath: targetUserDataPath,
  legacyPaths: legacyUserDataPaths
});
const initialSessionDataPath = isolatedPaths?.sessionData || preparedBrandPaths.sessionDataPath;
const existingLegacyUserDataPath = preparedBrandPaths.existingLegacyDataPath;
const preserveLegacyStorage = !isolatedPaths && Boolean(existingLegacyUserDataPath && initialSessionDataPath === existingLegacyUserDataPath);
let activeUserDataPath = existingLegacyUserDataPath || targetUserDataPath;

// userData remains stable for single-instance identity. During the first migration,
// sessionData intentionally reads legacy Local Storage/IndexedDB; the marker moves the
// next launch to target without rebinding either Electron path after readiness.
app.setPath("userData", targetUserDataPath);
app.setPath("sessionData", initialSessionDataPath);
if (process.platform === "win32") app.setAppUserModelId(brand.appId);
const hasSingleInstanceLock = allowTestInstance || app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
const migrationResultUsesTarget = (result) => {
  return ["migrated", "not-needed", "already-migrated"].includes(result.status);
};
const migrationPromise = isolatedPaths
  ? Promise.resolve({ status: "not-needed", targetPath: targetUserDataPath })
  : hasSingleInstanceLock
  ? migrateBrandData({
      appDataPath,
      targetName: targetUserDataName,
      legacyNames: legacyUserDataNames
    }).catch(() => ({
      status: "fallback",
      sourcePath: existingLegacyUserDataPath,
      targetPath: targetUserDataPath
    }))
  : Promise.resolve({ status: "not-needed", targetPath: targetUserDataPath });

app.on("second-instance", () => {
  if (!bootstrapComplete) {
    pendingShowMainWindow = true;
    return;
  }
  showMainWindow();
});

function sendToMainWindow(channel, ...args) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const send = () => mainWindow?.webContents.send(channel, ...args);
  if (mainWindow.webContents.isLoading()) mainWindow.webContents.once("did-finish-load", send);
  else send();
}

function createTaskbarBadge(draw) {
  const size = 16;
  const bitmap = Buffer.alloc(size * size * 4);
  const setPixel = (x, y, red, green, blue, alpha = 255) => {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const offset = (y * size + x) * 4;
    bitmap[offset] = blue;
    bitmap[offset + 1] = green;
    bitmap[offset + 2] = red;
    bitmap[offset + 3] = alpha;
  };
  const circle = (centerX, centerY, radius, color) => {
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if ((x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2) setPixel(x, y, ...color);
      }
    }
  };
  draw({ circle, setPixel });
  return nativeImage.createFromBitmap(bitmap, { width: size, height: size, scaleFactor: 1 });
}

function getTaskbarIcons() {
  if (taskbarIcons) return taskbarIcons;
  taskbarIcons = {
    downloading: createTaskbarBadge(({ circle, setPixel }) => {
      circle(8, 8, 7, [245, 183, 44, 255]);
      for (let y = 3; y <= 9; y += 1) {
        setPixel(7, y, 45, 52, 59);
        setPixel(8, y, 45, 52, 59);
      }
      for (let offset = 0; offset <= 3; offset += 1) {
        setPixel(8 - offset, 9 + offset, 45, 52, 59);
        setPixel(8 + offset, 9 + offset, 45, 52, 59);
      }
    }),
    recording: createTaskbarBadge(({ circle }) => {
      circle(8, 8, 7, [255, 255, 255, 255]);
      circle(8, 8, 5, [235, 48, 63, 255]);
    }),
    processing: createTaskbarBadge(({ circle, setPixel }) => {
      circle(8, 8, 7, [42, 126, 211, 255]);
      circle(8, 8, 3, [244, 248, 252, 255]);
      circle(8, 8, 1, [42, 126, 211, 255]);
      for (const [x, y] of [[8, 1], [8, 15], [1, 8], [15, 8], [3, 3], [13, 3], [3, 13], [13, 13]]) {
        setPixel(x, y, 244, 248, 252);
      }
    })
  };
  return taskbarIcons;
}

function clearTaskbarPulse() {
  clearInterval(taskbarPulseTimer);
  taskbarPulseTimer = undefined;
}

function applyTaskbarState() {
  if (process.platform !== "win32" || !mainWindow || mainWindow.isDestroyed()) return;
  const state = modelDownloadActive ? "downloading" : requestedTaskbarState;
  clearTaskbarPulse();
  try {
    if (state === "downloading") {
      mainWindow.setOverlayIcon(getTaskbarIcons().downloading, "Descargando modelo de Whisper");
      mainWindow.setProgressBar(0.5);
      let visible = true;
      taskbarPulseTimer = setInterval(() => {
        if (!mainWindow || mainWindow.isDestroyed()) return clearTaskbarPulse();
        try {
          visible = !visible;
          mainWindow.setProgressBar(visible ? 0.5 : -1);
        } catch (error) {
          clearTaskbarPulse();
          console.error("Could not pulse Windows taskbar progress:", error);
        }
      }, 650);
      taskbarPulseTimer.unref?.();
      return;
    }
    if (state === "recording") {
      mainWindow.setOverlayIcon(getTaskbarIcons().recording, "Grabando audio");
      mainWindow.setProgressBar(-1);
      return;
    }
    if (state === "processing") {
      mainWindow.setOverlayIcon(getTaskbarIcons().processing, "Procesando inferencia de Whisper");
      mainWindow.setProgressBar(2);
      return;
    }
    mainWindow.setProgressBar(-1);
    mainWindow.setOverlayIcon(null, "");
  } catch (error) {
    console.error("Could not update Windows taskbar state:", error);
  }
}

function setRequestedTaskbarState(state) {
  const nextState = ["idle", "recording", "processing"].includes(state) ? state : "idle";
  if (requestedTaskbarState === nextState) return;
  requestedTaskbarState = nextState;
  applyTaskbarState();
}

function setModelDownloadActive(active) {
  const nextActive = Boolean(active);
  if (modelDownloadActive === nextActive) return;
  modelDownloadActive = nextActive;
  applyTaskbarState();
}

function showMainWindow(panel) {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (panel) sendToMainWindow("app:navigate", panel);
}

function hideToTray() {
  mainWindow?.hide();
}

function configureAutoStart(enabled) {
  const executablePath = resolveAutoStartExecutablePath({
    platform: process.platform,
    executablePath: app.getPath("exe"),
    appImagePath: process.env.APPIMAGE
  });
  return configurePlatformAutoStart({
    platform: process.platform,
    enabled,
    isPackaged: app.isPackaged,
    isolated: isolatedTestMode,
    displayName: brand.displayName,
    executablePath,
    homePath: app.getPath("home"),
    configHome: process.env.XDG_CONFIG_HOME,
    appSetLoginItemSettings: (settings) => app.setLoginItemSettings(settings),
    appGetLoginItemSettings: (settings) => app.getLoginItemSettings(settings),
    disableLegacyItems: () => disableLegacyLoginItems({
      isPackaged: app.isPackaged,
      platform: process.platform,
      isolated: isolatedTestMode,
      exePath: app.getPath("exe"),
      localAppData: process.env.LOCALAPPDATA,
      legacyNames: brand.legacyDataNames,
      setter: (settings) => app.setLoginItemSettings(settings)
    })
  });
}

function readAutoStart() {
  const executablePath = resolveAutoStartExecutablePath({
    platform: process.platform,
    executablePath: app.getPath("exe"),
    appImagePath: process.env.APPIMAGE
  });
  return getPlatformAutoStartEnabled({
    platform: process.platform,
    isPackaged: app.isPackaged,
    isolated: isolatedTestMode,
    displayName: brand.displayName,
    executablePath,
    homePath: app.getPath("home"),
    configHome: process.env.XDG_CONFIG_HOME,
    appGetLoginItemSettings: (settings) => app.getLoginItemSettings(settings)
  });
}

function initializeAutoStart() {
  const userDataPath = activeUserDataPath;
  const isFirstLaunch = !hasAutoStartPreference(userDataPath);
  const enabled = getAutoStartEnabled(userDataPath);
  let applied = false;
  try {
    applied = configureAutoStart(enabled);
  } catch (error) {
    console.warn(`Could not configure auto-start on ${process.platform}:`, error);
  }
  if (isFirstLaunch && app.isPackaged) {
    setAutoStartEnabled(userDataPath, applied);
  }
}

async function handleRecordShortcut() {
  if (!shortcutRecording) {
    try {
      await capturePasteTarget();
    } catch (error) {
      console.error("Could not capture paste target:", error);
    }
  }
  shortcutRecording = !shortcutRecording;
  sendToMainWindow("shortcut:toggle");
}

function handleHoldShortcutPressed() {
  if (shortcutRecording) return;
  shortcutRecording = true;
  capturePasteTarget().catch((error) => console.error("Could not capture paste target:", error));
  sendToMainWindow("shortcut:pressed");
}

function handleHoldShortcutReleased() {
  if (!shortcutRecording) return;
  shortcutRecording = false;
  sendToMainWindow("shortcut:released");
}

async function handleReprocessShortcut() {
  try {
    await capturePasteTarget();
  } catch (error) {
    console.error("Could not capture paste target:", error);
  }
  sendToMainWindow("shortcut:reprocess");
}

function stopShortcutMonitors() {
  const hadMonitors = shortcutMonitors.size > 0;
  for (const state of shortcutMonitors.values()) {
    if (!state.process.killed) state.process.kill();
  }
  shortcutMonitors.clear();
  if (hadMonitors || activeShortcutMode === "hold") handleHoldShortcutReleased();
}

function startShortcutMonitor(kind, accelerator, mode = "hold") {
  if (process.platform !== "win32") throw new Error("El modo mantener solo esta disponible en Windows.");
  const helper = pasteHelperPath();
  if (!fsSync.existsSync(helper)) throw new Error("Falta el helper nativo requerido para el modo mantener.");

  const monitor = spawn(helper, ["monitor-shortcut", "--accelerator", accelerator], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const state = { process: monitor, buffer: "", ready: false };
  shortcutMonitors.set(kind, state);
  monitor.stdout.setEncoding("utf8");
  monitor.stdout.on("data", (chunk) => {
    state.buffer += chunk;
    const lines = state.buffer.split(/\r?\n/);
    state.buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (event.type === "ready") state.ready = true;
        if (event.type === "pressed") {
          if (kind === "reprocess") handleReprocessShortcut();
          else if (mode === "hold") handleHoldShortcutPressed();
          else handleRecordShortcut();
        }
        if (kind === "record" && event.type === "released" && mode === "hold") handleHoldShortcutReleased();
        if (event.type === "error") console.error("Shortcut monitor hook error:", event.error);
      } catch (error) {
        console.error("Invalid shortcut monitor event:", error);
      }
    }
  });
  monitor.stderr.on("data", (chunk) => console.error("Shortcut monitor:", chunk.toString().trim()));
  monitor.on("error", (error) => {
    if (shortcutMonitors.get(kind)?.process !== monitor) return;
    shortcutMonitors.delete(kind);
    if (kind === "record") handleHoldShortcutReleased();
    console.error("Shortcut monitor failed:", error);
    sendToMainWindow("shortcut:error");
  });
  monitor.on("exit", (code) => {
    if (shortcutMonitors.get(kind)?.process !== monitor) return;
    shortcutMonitors.delete(kind);
    if (kind === "record") handleHoldShortcutReleased();
    console.error(`Shortcut monitor exited unexpectedly with code ${code}.`);
    sendToMainWindow("shortcut:error");
  });
}

function registerGlobalShortcuts(shortcuts, mode = activeShortcutMode) {
  if (!shortcuts || shortcuts.record === shortcuts.reprocess) {
    throw new Error("Los atajos deben ser diferentes.");
  }

  if (!["toggle", "hold"].includes(mode)) throw new Error(`Unsupported shortcut mode: ${mode}`);

  const previous = activeShortcuts;
  const previousMode = activeShortcutMode;
  stopShortcutMonitors();
  globalShortcut.unregisterAll();
  let recordRegistered = false;
  let reprocessRegistered = false;
  try {
    if (process.platform === "win32") {
      startShortcutMonitor("record", shortcuts.record, mode);
      recordRegistered = true;
    } else if (mode === "hold") {
      throw new Error("El modo mantener solo esta disponible en Windows.");
    } else {
      recordRegistered = globalShortcut.register(shortcuts.record, handleRecordShortcut)
        && globalShortcut.isRegistered(shortcuts.record);
    }
    if (recordRegistered && process.platform === "win32") {
      startShortcutMonitor("reprocess", shortcuts.reprocess, "toggle");
      reprocessRegistered = true;
    } else {
      reprocessRegistered = recordRegistered
        && globalShortcut.register(shortcuts.reprocess, handleReprocessShortcut)
        && globalShortcut.isRegistered(shortcuts.reprocess);
    }
  } catch (error) {
    console.error("Invalid global shortcut:", error);
  }

  if (recordRegistered && reprocessRegistered) {
    activeShortcuts = { ...shortcuts };
    activeShortcutMode = mode;
    shortcutRegistrationStatus = { record: true, reprocess: true };
    return activeShortcuts;
  }

  stopShortcutMonitors();
  globalShortcut.unregisterAll();
  shortcutRegistrationStatus = { record: false, reprocess: false };
  if (previous) {
    try {
      if (process.platform === "win32") {
        startShortcutMonitor("record", previous.record, previousMode);
        startShortcutMonitor("reprocess", previous.reprocess, "toggle");
      }
      else if (previousMode === "hold") throw new Error("El modo mantener solo esta disponible en Windows.");
      else globalShortcut.register(previous.record, handleRecordShortcut);
      if (process.platform !== "win32") globalShortcut.register(previous.reprocess, handleReprocessShortcut);
      activeShortcuts = previous;
      activeShortcutMode = previousMode;
      shortcutRegistrationStatus = {
        record: process.platform === "win32" || globalShortcut.isRegistered(previous.record),
        reprocess: process.platform === "win32" || globalShortcut.isRegistered(previous.reprocess)
      };
    } catch (restoreError) {
      console.error("Failed to restore previous shortcuts:", restoreError);
    }
  }
  throw new Error("Windows rechazó uno de los atajos. Puede estar en uso por otra aplicación.");
}

function createTray() {
  const trayImage = nativeImage.createFromPath(path.join(__dirname, "..", "assets", "app-icon-32.png"));
  tray = new Tray(trayImage.resize({ width: 16, height: 16 }));
  tray.setToolTip(brand.displayName);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `${brand.displayName} v${app.getVersion()}`, enabled: false },
    { type: "separator" },
    { label: "Inicio", click: () => showMainWindow("home") },
    { label: "Buscar actualizaciones...", click: () => checkForUpdates(true) },
    { label: "Pegar última transcripción", click: () => sendToMainWindow("tray:paste-last") },
    { type: "separator" },
    {
      label: "Enviar comentarios...",
      click: () => shell.openExternal(brand.issueUrl)
    },
    { type: "separator" },
    {
      label: "Salir",
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]));
  tray.on("click", async () => {
    await capturePasteTarget().catch(() => {});
    tray?.popUpContextMenu();
  });
  tray.on("right-click", () => capturePasteTarget().catch(() => {}));
  tray.on("double-click", () => showMainWindow());
}

function configureAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-not-available", () => {
    if (!manualUpdateCheck) return;
    manualUpdateCheck = false;
    dialog.showMessageBox({
      type: "info",
      title: `${brand.displayName} está actualizado`,
      message: `Ya tienes la versión más reciente (${app.getVersion()}).`
    });
  });
  autoUpdater.on("update-available", () => {
    if (manualUpdateCheck) {
      dialog.showMessageBox({
        type: "info",
        title: "Actualización encontrada",
        message: "La nueva versión se está descargando y se instalará automáticamente."
      });
    }
    manualUpdateCheck = false;
  });
  autoUpdater.on("update-downloaded", (info) => {
    sendToMainWindow("update:downloaded", { version: info?.version });
  });
  autoUpdater.on("error", (error) => {
    console.error("Update check failed:", error);
    if (!manualUpdateCheck) return;
    manualUpdateCheck = false;
    dialog.showMessageBox({
      type: "error",
      title: "No se pudo buscar actualizaciones",
      message: "Revisa tu conexión e inténtalo nuevamente."
    });
  });
}

function checkForUpdates(interactive = false) {
  if (isolatedTestMode) return;
  if (!acceptedRuntimeActive) {
    if (interactive) {
      showMainWindow();
      dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "Aceptación pendiente",
        message: "Acepta los Términos de uso antes de buscar actualizaciones."
      }).catch(() => {});
    }
    return;
  }
  if (!app.isPackaged) {
    if (interactive) {
      dialog.showMessageBox({
        type: "info",
        title: "Actualizaciones",
        message: "La búsqueda de actualizaciones está disponible en la aplicación instalada."
      });
    }
    return;
  }
  manualUpdateCheck = interactive;
  autoUpdater.checkForUpdates().catch((error) => {
    console.error("Could not start update check:", error);
  });
}

async function handleWindowClose(event) {
  if (isQuitting) return;
  if (!isolatedTestMode && !hasAcceptedCurrentTerms(activeUserDataPath)) {
    isQuitting = true;
    app.quit();
    return;
  }
  event.preventDefault();
  if (closeDialogOpen) return;

  const behavior = getCloseBehavior(activeUserDataPath);
  if (behavior === "tray") {
    hideToTray();
    return;
  }
  if (behavior === "exit") {
    isQuitting = true;
    app.quit();
    return;
  }

  closeDialogOpen = true;
  try {
    const choice = await dialog.showMessageBox(mainWindow, {
      type: "question",
      title: `Cerrar ${brand.displayName}`,
      message: "¿Qué quieres hacer al cerrar la ventana?",
      detail: "Ocultarla en la bandeja mantiene disponibles el dictado y los atajos globales.",
      buttons: ["Ocultar en la bandeja", `Salir de ${brand.displayName}`, "Cancelar"],
      defaultId: 0,
      cancelId: 2,
      checkboxLabel: "Recordar mi elección",
      checkboxChecked: false
    });
    if (choice.response === 2) return;
    const selectedBehavior = choice.response === 0 ? "tray" : "exit";
    if (choice.checkboxChecked) setCloseBehavior(activeUserDataPath, selectedBehavior);
    if (selectedBehavior === "tray") hideToTray();
    else {
      isQuitting = true;
      app.quit();
    }
  } finally {
    closeDialogOpen = false;
  }
}

// Model loading is otherwise fully lazy: the first dictation after each app
// launch pays the entire cold-load cost (measured ~5s for the cached Large
// v3 Turbo build) with no "still loading" signal until after the user stops
// recording. Warming it in the background right after bootstrap means it's
// usually already loaded (or nearly done) by the time a real recording
// finishes. Best-effort only: any failure here just falls back to the
// existing lazy load on the first real transcribe request.
async function warmTranscriberOnStartup() {
  try {
    const { settings } = await readState(activeUserDataPath);
    await transcriptionService.prepare(settings.whisperProfile, settings.inferenceDevice);
  } catch (error) {
    console.warn("Could not pre-warm the transcription model:", error);
  }
}

function getCurrentLegalStatus() {
  const acceptance = getLegalAcceptance(activeUserDataPath);
  return {
    accepted: isolatedTestMode || acceptance?.termsVersion === CURRENT_TERMS_VERSION,
    currentTermsVersion: CURRENT_TERMS_VERSION,
    acceptance,
    contactEmail: "legal@felipeavinzano.com"
  };
}

function registerAcceptedShortcuts() {
  try {
    registerGlobalShortcuts(getShortcuts(activeUserDataPath), getShortcutMode(activeUserDataPath));
  } catch (error) {
    console.error("Could not register global shortcuts:", error);
    try {
      registerGlobalShortcuts(DEFAULT_SHORTCUTS);
      setShortcuts(activeUserDataPath, DEFAULT_SHORTCUTS);
      setShortcutMode(activeUserDataPath, "toggle");
    } catch (fallbackError) {
      console.error("Could not register default global shortcuts:", fallbackError);
    }
    sendToMainWindow("shortcut:error");
  }
}

function activateAcceptedRuntime() {
  if (acceptedRuntimeActive || isolatedTestMode) return;
  if (!hasAcceptedCurrentTerms(activeUserDataPath)) throw new Error("Current Terms have not been accepted.");
  acceptedRuntimeActive = true;
  initializeAutoStart();
  configureAutoUpdater();
  checkForUpdates();
  registerAcceptedShortcuts();
  warmTranscriberOnStartup();
}

function rendererBrandArguments() {
  const capabilities = resolvePlatformCapabilities(process.platform, app.isPackaged);
  return [
    `--voiceflow-brand-display-name=${encodeURIComponent(brand.displayName)}`,
    `--voiceflow-brand-base-name=${encodeURIComponent(brand.baseName)}`,
    `--voiceflow-brand-suffix=${encodeURIComponent(brand.suffix)}`,
    `--voiceflow-brand-copper=${encodeURIComponent(brand.copper)}`,
    `--voiceflow-app-version=${encodeURIComponent(app.getVersion())}`,
    `--voiceflow-platform=${encodeURIComponent(process.platform)}`,
    `--voiceflow-capabilities=${encodeURIComponent(JSON.stringify(capabilities))}`
  ];
}

function createWindow() {
  mainWindow = new BrowserWindow({
    show: !startHidden || (!isolatedTestMode && !hasAcceptedCurrentTerms(activeUserDataPath)),
    width: 1060,
    height: 720,
    minWidth: 860,
    minHeight: 620,
    title: brand.displayName,
    icon: path.join(__dirname, "..", "assets", "app-icon.png"),
    backgroundColor: "#F4F1EB",
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#F4F1EB",
      symbolColor: "#0D1B2A",
      height: 48
    },
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      additionalArguments: [
        ...rendererBrandArguments(),
        `--voiceflow-preserve-legacy-storage=${preserveLegacyStorage ? '1' : '0'}`
      ],
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "..", "index.html"));
  applyTaskbarState();
  mainWindow.on("close", handleWindowClose);
  mainWindow.on("closed", () => {
    clearTaskbarPulse();
    mainWindow = null;
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close();
  });
}

function positionOverlay() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y, width, height } = display.workArea;
  const [overlayWidth, overlayHeight] = overlayWindow.getSize();
  overlayWindow.setPosition(
    Math.round(x + (width - overlayWidth) / 2),
    Math.round(y + height - overlayHeight - 34),
    false
  );
}

function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    width: 420,
    height: 142,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "overlay-preload.cjs"),
      additionalArguments: rendererBrandArguments(),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  // macOS runs a genuine fullscreen app in its own Space; Spaces isolation
  // hides every other window there regardless of alwaysOnTop level unless
  // it opts in with visibleOnFullScreen. Windows/Linux ignore this option.
  if (process.platform === "darwin") {
    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  overlayWindow.setIgnoreMouseEvents(true);
  overlayWindow.loadFile(path.join(__dirname, "..", "overlay.html"));
}

function updateOverlay(state) {
  if (!overlayWindow || overlayWindow.isDestroyed()) createOverlayWindow();
  const sendState = () => overlayWindow?.webContents.send("overlay:state", state);
  if (overlayWindow.webContents.isLoading()) overlayWindow.webContents.once("did-finish-load", sendState);
  else sendState();
  if (state.status === "idle") {
    overlayWindow.hide();
    return;
  }
  positionOverlay();
  // Windows silently drops a window's topmost band once another app goes
  // fullscreen and takes the foreground; re-asserting right before showing
  // forces the overlay back above it instead of staying hidden behind it.
  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.showInactive();
}

function pasteHelperPath() {
  return resolveWin32HelperPath({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appRoot: path.join(__dirname, ".."),
    helperExecutableName: brand.helperExecutable
  });
}

const inputStrategy = createInputStrategy({ helperPath: pasteHelperPath() });

async function capturePasteTarget() {
  pasteTarget = await inputStrategy.captureTarget();
}

async function pasteIntoActiveApp(text, writeClipboard = true) {
  if (writeClipboard) clipboard.writeText(text);

  const target = pasteTarget;
  pasteTarget = undefined;
  try {
    return await inputStrategy.paste(target);
  } catch (error) {
    console.error("Native input helper could not inject paste:", error);
    return { ok: false, reason: PASTE_FAILURE_REASON.UNKNOWN };
  }
}

async function runPackagedModelSelfTest() {
  const argument = process.argv.find((value) => value.startsWith("--self-test-model="));
  if (!argument) return false;
  const profileId = argument.split("=")[1];
  const profile = resolveWhisperProfile(profileId);
  const result = await transcriptionService.transcribe(new Float32Array(32000), "spanish", profile.id, "cpu");
  const reportArgument = process.argv.find((value) => value.startsWith("--self-test-report="));
  if (reportArgument) {
    const cacheDir = getModelCacheDir(activeUserDataPath);
    const reportPath = path.resolve(reportArgument.slice("--self-test-report=".length));
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, JSON.stringify({
      cacheBytes: await directorySize(cacheDir),
      cacheDir,
      device: result.device,
      dtype: profile.dtype,
      model: profile.model,
      profile: profile.id
    }, null, 2), "utf8");
  }
  return true;
}

async function runAudioWorkletSelfTest() {
  if (!process.argv.includes("--self-test-audio-worklet")) return false;
  const testWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  try {
    await testWindow.loadFile(path.join(__dirname, "..", "index.html"));
    const result = await testWindow.webContents.executeJavaScript(`
      (async () => {
        const context = new AudioContext({ sampleRate: 16000 });
        try {
          await context.audioWorklet.addModule("src/pcm-capture-worklet.js");
          const node = new AudioWorkletNode(context, "voiceflow-pcm-capture");
          node.disconnect();
          return { sampleRate: context.sampleRate, state: context.state };
        } finally {
          await context.close();
        }
      })()
    `);
    if (result.sampleRate !== 16000) throw new Error(`Unexpected audio sample rate: ${result.sampleRate}`);
  } finally {
    testWindow.destroy();
  }
  return true;
}

async function runDesktopBridgeSelfTest() {
  if (!process.argv.includes("--self-test-desktop-bridge")) return false;
  const preloadErrors = [];
  const rendererErrors = [];
  const testWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      additionalArguments: [
        ...rendererBrandArguments(),
        "--voiceflow-preserve-legacy-storage=0"
      ],
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  testWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    preloadErrors.push(`${preloadPath}: ${error?.message || error}`);
  });
  testWindow.webContents.on("console-message", (_event, details) => {
    if (details?.level === "error") {
      rendererErrors.push(`${details.sourceId || "renderer"}:${details.lineNumber || 0} ${details.message || "unknown error"}`);
    }
  });
  try {
    await testWindow.loadFile(path.join(__dirname, "..", "index.html"));
    const result = await testWindow.webContents.executeJavaScript(`(async () => {
      const deadline = Date.now() + 10000;
      while (document.documentElement.dataset.voiceflowInitialized !== "true" && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return {
        hasVoiceAPI: Boolean(window.voiceAPI),
        displayName: window.voiceAPI?.brand?.displayName,
        canTranscribe: typeof window.voiceAPI?.transcribe === "function",
        canReadState: typeof window.voiceAPI?.getState === "function",
        initialized: document.documentElement.dataset.voiceflowInitialized === "true"
      };
    })()`);
    if (preloadErrors.length) throw new Error(`Preload failed: ${preloadErrors.join(" | ")}`);
    if (!result.hasVoiceAPI || !result.canTranscribe || !result.canReadState) {
      throw new Error(`Desktop bridge unavailable: ${JSON.stringify(result)}`);
    }
    if (result.displayName !== brand.displayName) {
      throw new Error(`Desktop bridge brand mismatch: ${result.displayName}`);
    }
    if (!result.initialized || rendererErrors.length) {
      throw new Error(`Renderer startup failed: ${rendererErrors.join(" | ") || "initialization marker was not set"}`);
    }
  } finally {
    testWindow.destroy();
  }
  return true;
}

async function runShortcutSelfTest() {
  if (!process.argv.includes("--self-test-shortcuts")) return false;
  const shortcuts = registerGlobalShortcuts(DEFAULT_SHORTCUTS, "toggle");
  if (process.platform === "win32") {
    await new Promise((resolve) => setTimeout(resolve, 400));
    const recordMonitor = shortcutMonitors.get("record");
    const reprocessMonitor = shortcutMonitors.get("reprocess");
    if (!recordMonitor?.ready || recordMonitor.process.killed || !reprocessMonitor?.ready || reprocessMonitor.process.killed) {
      throw new Error("The native Windows shortcut monitors did not become ready.");
    }
  }
  const report = {
    shortcuts,
    registered: { ...shortcutRegistrationStatus }
  };
  const reportArgument = process.argv.find((value) => value.startsWith("--self-test-shortcut-report="));
  if (reportArgument) {
    const reportPath = path.resolve(reportArgument.slice("--self-test-shortcut-report=".length));
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  }
  if (!report.registered.record || !report.registered.reprocess) {
    throw new Error(`Shortcut registration failed: ${JSON.stringify(report)}`);
  }
  return true;
}

app.whenReady().then(async () => {
  brandMigration = await migrationPromise;
  if (process.platform === "darwin" && app.isPackaged) {
    startHidden ||= Boolean(app.getLoginItemSettings().wasOpenedAtLogin);
  }
  const migrationUsesTarget = migrationResultUsesTarget(brandMigration);
  if (!migrationUsesTarget) {
    brandMigration = {
      ...brandMigration,
      status: "fallback",
      sourcePath: brandMigration.sourcePath || existingLegacyUserDataPath
    };
  }
  activeUserDataPath = migrationUsesTarget
    ? targetUserDataPath
    : brandMigration.sourcePath || existingLegacyUserDataPath || targetUserDataPath;
  initDb(activeUserDataPath);
  historyWriteQueue = createHistoryWriteQueue({
    insert: insertTranscription,
    trim: trimTranscriptions,
    onError: (error) => console.error("Could not persist transcription history:", error)
  });
  transcriptionMetricsStore = createTranscriptionMetricsStore(activeUserDataPath);
  modelPackManager = createModelPackManager(activeUserDataPath, app.getVersion());
  transcriptionService = createTranscriptionService({
    userDataPath: activeUserDataPath,
    resolveProfile: resolveWhisperProfile,
    ensureModelCache: async (userDataPath, profileId) => {
      const packs = await modelPackManager.list();
      const offlinePack = packs.find((pack) => pack.valid !== false && pack.engine === "transformers-js" && pack.profile === profileId);
      return offlinePack?.directory || ensureModelCache(userDataPath, profileId);
    },
    loadModelWithRetry,
    // Local-first: transformers.js siempre prefiere el modelo ya cacheado; solo
    // descarga (una vez, desde Hugging Face) cuando el modelo no existe en la
    // máquina. Necesario para provisionar el modelo en instalaciones nuevas
    // (el .onnx no se empaqueta). El audio del usuario nunca sale del equipo.
    allowRemoteModels: true,
    onDownloadState: setModelDownloadActive,
    onProgress: (progress) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send("model:progress", progress);
    }
  });
  if (process.platform === "win32") inputStrategy.warm?.();

  try {
    if (await runShortcutSelfTest()) {
      app.exit(0);
      return;
    }
    if (await runDesktopBridgeSelfTest()) {
      app.exit(0);
      return;
    }
    if (await runAudioWorkletSelfTest()) {
      app.exit(0);
      return;
    }
    if (await runPackagedModelSelfTest()) {
      app.exit(0);
      return;
    }
  } catch (error) {
    console.error("Application self-test failed:", error);
    app.exit(1);
    return;
  }

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return permission === "media" && hasAcceptedCurrentTerms(activeUserDataPath);
  });
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media" && hasAcceptedCurrentTerms(activeUserDataPath));
  });

  createWindow();
  createOverlayWindow();
  createTray();
  bootstrapComplete = true;
  if (pendingShowMainWindow) {
    pendingShowMainWindow = false;
    showMainWindow();
  }
  if (brandMigration.status === "fallback") {
    dialog.showMessageBox(mainWindow, {
      type: "error",
      title: `${brand.displayName}: no se pudieron migrar los datos`,
      message: "La aplicación usará tus datos anteriores durante esta sesión.",
      detail: "No se eliminó ningún dato. Cierra la aplicación y vuelve a intentarlo."
    }).catch(() => {});
  }
  if (hasAcceptedCurrentTerms(activeUserDataPath)) activateAcceptedRuntime();
}).catch(() => {
  console.error("Application bootstrap failed.");
  app.exit(1);
});

ipcMain.handle("clipboard:write", (_event, text) => {
  clipboard.writeText(text);
  return true;
});

ipcMain.handle("clipboard:paste", async (_event, text) => {
  return pasteIntoActiveApp(text);
});

ipcMain.handle("delivery:commit", async (_event, text, options = {}) => {
  const startedAt = performance.now();
  const copy = Boolean(options.copy || options.paste);
  const paste = Boolean(options.paste);
  const clipboardStartedAt = performance.now();
  if (copy) clipboard.writeText(text);
  const clipboardMs = Math.round(performance.now() - clipboardStartedAt);

  let pasteResult = { ok: false, reason: PASTE_FAILURE_REASON.NO_CAPTURE_TARGET };
  const pasteStartedAt = performance.now();
  if (paste) pasteResult = await pasteIntoActiveApp(text, false);
  const pasteMs = paste ? Math.round(performance.now() - pasteStartedAt) : 0;
  const visibleAtEpochMs = Date.now();

  if (options.saveHistory !== false) historyWriteQueue.enqueue(text, options.historyLimit);
  return {
    pasted: paste && pasteResult.ok,
    reason: paste ? pasteResult.reason : undefined,
    historyQueued: options.saveHistory !== false,
    metrics: {
      clipboardMs,
      focusMs: pasteResult.focusMs,
      pasteMs,
      historyMs: 0,
      endToPasteMs: Number.isFinite(options.captureFinishedAtEpochMs)
        ? Math.max(0, visibleAtEpochMs - options.captureFinishedAtEpochMs)
        : undefined,
      deliveryMs: Math.round(performance.now() - startedAt)
    }
  };
});

ipcMain.handle("metrics:record", (_event, metric) => {
  const enrichedMetric = {
    ...metric,
    memoryRssMb: Math.round(process.memoryUsage().rss / 1024 / 1024)
  };
  transcriptionMetricsStore.append(enrichedMetric).catch((error) => console.error("Could not persist transcription metrics:", error));
  return true;
});
ipcMain.handle("metrics:summary", () => transcriptionMetricsStore.summary());

ipcMain.handle("paste:notify-permission-denied", async () => {
  await notifyPastePermissionDenied({
    platform: process.platform,
    userDataPath: activeUserDataPath,
    dialogApi: dialog,
    shellApi: shell
  });
});

ipcMain.handle("history:export", async (_event, entries) => {
  if (!Array.isArray(entries)) throw new Error("History entries must be an array.");
  const safeEntries = entries.map((entry) => ({
    at: typeof entry?.at === "string" ? entry.at : "",
    text: typeof entry?.text === "string" ? entry.text : ""
  }));
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Exportar historial",
    defaultPath: `${brand.slug}-History-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: "JSON", extensions: ["json"] }]
  });
  if (result.canceled || !result.filePath) return false;
  await fs.writeFile(result.filePath, JSON.stringify({ version: 1, entries: safeEntries }, null, 2), "utf8");
  return true;
});
ipcMain.handle("state:get", () => readState(activeUserDataPath));
ipcMain.handle("state:migrate-legacy", (_event, legacyState) => migrateLegacyState(activeUserDataPath, legacyState));
ipcMain.handle("state:write", (_event, state) => writeState(activeUserDataPath, state));

const LEGAL_DOCUMENTS = Object.freeze({
  "terms:es": "TERMS.md",
  "terms:en": "TERMS.en.md",
  "privacy:es": "PRIVACY.md",
  "privacy:en": "PRIVACY.en.md",
  "licenses:es": "THIRD_PARTY_NOTICES.md",
  "ai-act:es": "docs/AI_ACT_CLASSIFICATION.md"
});

ipcMain.handle("legal:get-status", () => getCurrentLegalStatus());
ipcMain.handle("legal:accept-current-terms", () => {
  acceptCurrentTerms(activeUserDataPath);
  activateAcceptedRuntime();
  return getCurrentLegalStatus();
});
ipcMain.handle("legal:decline-current-terms", () => {
  isQuitting = true;
  app.quit();
  return true;
});
ipcMain.handle("legal:read-document", async (_event, type, language = "es") => {
  const relativePath = LEGAL_DOCUMENTS[`${type}:${language}`];
  if (!relativePath) throw new Error("Unsupported legal document.");
  return {
    type,
    language,
    content: await fs.readFile(path.join(__dirname, "..", relativePath), "utf8")
  };
});
ipcMain.handle("legal:contact", () => shell.openExternal("mailto:legal@felipeavinzano.com"));

ipcMain.handle("privacy:erase-local-personal-data", async () => {
  if (!hasAcceptedCurrentTerms(activeUserDataPath)) throw new Error("Current Terms have not been accepted.");
  stopShortcutMonitors();
  globalShortcut.unregisterAll();
  configureAutoStart(false);
  await transcriptionService.reset();
  closeDb();
  await session.defaultSession.clearStorageData({ storages: ["localstorage", "indexdb"] });
  const removed = await erasePersonalDataFiles(activeUserDataPath);
  app.relaunch();
  isQuitting = true;
  app.quit();
  return { removed };
});

ipcMain.handle("transcriptions:get-all", (_event, limit) => getAllTranscriptions(limit));
ipcMain.handle("transcriptions:add", (_event, texto, limit) => {
  const row = insertTranscription(texto);
  trimTranscriptions(limit);
  return row;
});
ipcMain.handle("transcriptions:delete", (_event, id) => deleteTranscription(id));
ipcMain.handle("transcriptions:clear", () => clearTranscriptions());
ipcMain.handle("transcriptions:trim", (_event, limit) => trimTranscriptions(limit));
ipcMain.handle("transcriptions:migrate-legacy", (_event, entries) => migrateLegacyHistory(entries));

ipcMain.handle("transcription:run", async (_event, audio, language, profileId, device) => {
  if (!isolatedTestMode && !hasAcceptedCurrentTerms(activeUserDataPath)) {
    throw new Error("Current Terms have not been accepted.");
  }
  return transcriptionService.transcribe(audio, language, profileId, device);
});

ipcMain.handle("transcription:start", (_event, configuration) => {
  if (!isolatedTestMode && !hasAcceptedCurrentTerms(activeUserDataPath)) {
    throw new Error("Current Terms have not been accepted.");
  }
  if (!configuration || !["auto", "transformers-js"].includes(configuration.engine || "auto")) {
    throw new Error("El motor solicitado no está instalado o validado.");
  }
  return transcriptionService.start(configuration);
});
ipcMain.on("transcription:audio", (_event, sessionId, audio) => {
  transcriptionService.pushAudio(sessionId, audio);
});
ipcMain.handle("transcription:finish", (_event, sessionId) => transcriptionService.finish(sessionId));
ipcMain.handle("transcription:cancel", (_event, sessionId) => transcriptionService.cancel(sessionId));

ipcMain.handle("models:clear", async () => {
  await transcriptionService.reset();
  await clearModelCache(activeUserDataPath);
  return true;
});

ipcMain.handle("models:repair", async (_event, profileId, device) => {
  const profile = resolveWhisperProfile(profileId);
  await transcriptionService.reset();
  await transcriptionService.prepare(profile.id, device, 1);
  const cacheDir = getModelCacheDir(activeUserDataPath);
  const health = transcriptionService.health();
  return {
    cacheMb: Math.round(await directorySize(cacheDir) / 1024 / 1024),
    cacheRebuilt: false,
    device: health.device,
    profile: health.profile
  };
});

ipcMain.handle("models:list-packs", () => modelPackManager.list({ verify: true }));
ipcMain.handle("models:install-pack", async () => {
  const selection = await dialog.showOpenDialog(mainWindow, {
    title: "Instalar paquete de modelo offline",
    properties: ["openDirectory"]
  });
  if (selection.canceled || !selection.filePaths[0]) return { canceled: true };
  return { canceled: false, pack: await modelPackManager.install(selection.filePaths[0]) };
});

ipcMain.handle("overlay:set-state", (_event, state) => {
  updateOverlay(state);
  if (state.status === "idle" && activeShortcutMode === "toggle") shortcutRecording = false;
  return true;
});
ipcMain.on("audio-data-update", (_event, frequencyData) => {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.webContents.send("audio-data-update", frequencyData);
});
ipcMain.handle("taskbar:set-state", (_event, state) => {
  setRequestedTaskbarState(state?.status);
  return true;
});

function safeBrandMigrationDiagnostics() {
  const diagnostics = { status: brandMigration.status };
  if (typeof brandMigration.sourcePath === "string") diagnostics.sourcePath = brandMigration.sourcePath;
  return diagnostics;
}

ipcMain.handle("app:diagnostics", async () => {
  const cacheDir = getModelCacheDir(activeUserDataPath);
  const memory = process.memoryUsage();
  const transcription = transcriptionService.health();
  return {
    platform: `${process.platform} ${process.arch}`,
    version: app.getVersion(),
    transcriptionEngine: transcription.engine,
    loadedWhisperProfile: transcription.profile,
    inferenceDevice: transcription.device,
    requestedInferenceDevice: transcription.requestedDevice,
    lastDeviceFallback: transcription.lastDeviceFallback,
    shortcuts: activeShortcuts || getShortcuts(activeUserDataPath),
    shortcutRegistered: { ...shortcutRegistrationStatus },
    shortcutMode: activeShortcutMode,
    shortcutMonitorReady: Object.fromEntries([...shortcutMonitors].map(([kind, state]) => [kind, state.ready])),
    memoryRssMb: Math.round(memory.rss / 1024 / 1024),
    heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
    lastModelLoadMs: transcription.lastModelLoadMs,
    lastModelLoadAttempts: transcription.lastModelLoadAttempts,
    lastModelError: transcription.lastModelError,
    lastTranscriptionMetrics: transcription.lastTranscriptionMetrics,
    transcriptionMetricsSummary: await transcriptionMetricsStore.summary(),
    inputHelper: inputStrategy.health?.(),
    modelPacks: (await modelPackManager.list()).map(({ directory, ...pack }) => pack),
    stateSchemaVersion: STATE_SCHEMA_VERSION,
    statePath: statePath(activeUserDataPath),
    modelCacheMb: Math.round(await directorySize(cacheDir) / 1024 / 1024),
    modelCacheDir: cacheDir,
    brandMigration: safeBrandMigrationDiagnostics()
  };
});
ipcMain.handle("app:get-close-behavior", () => getCloseBehavior(activeUserDataPath));
ipcMain.handle("app:set-close-behavior", (_event, behavior) => setCloseBehavior(activeUserDataPath, behavior));
ipcMain.handle("preferences:get-shortcuts", () => activeShortcuts || getShortcuts(activeUserDataPath));
ipcMain.handle("preferences:set-shortcuts", (_event, shortcuts) => {
  const registered = registerGlobalShortcuts(shortcuts, activeShortcutMode);
  setShortcuts(activeUserDataPath, registered);
  return registered;
});
ipcMain.handle("preferences:get-shortcut-mode", () => activeShortcutMode);
ipcMain.handle("preferences:set-shortcut-mode", (_event, mode) => {
  const shortcuts = activeShortcuts || getShortcuts(activeUserDataPath);
  const previousMode = activeShortcutMode;
  registerGlobalShortcuts(shortcuts, mode);
  try {
    return setShortcutMode(activeUserDataPath, mode);
  } catch (error) {
    registerGlobalShortcuts(shortcuts, previousMode);
    throw error;
  }
});
ipcMain.handle("preferences:get-autostart", () => {
  if (isolatedTestMode) return getAutoStartEnabled(activeUserDataPath);
  const enabled = readAutoStart();
  setAutoStartEnabled(activeUserDataPath, enabled);
  return enabled;
});
ipcMain.handle("preferences:set-autostart", (_event, enabled) => {
  if (typeof enabled !== "boolean") throw new Error("Auto-start preference must be a boolean.");
  const applied = configureAutoStart(enabled);
  setAutoStartEnabled(activeUserDataPath, applied);
  return applied;
});

ipcMain.handle("window:minimize", () => mainWindow?.minimize());
ipcMain.handle("window:hide", () => mainWindow?.hide());

ipcMain.handle("update:check", () => checkForUpdates(true));
ipcMain.handle("update:install", () => {
  isQuitting = true;
  autoUpdater.quitAndInstall(false, true);
});

app.on("activate", () => {
  if (!bootstrapComplete) {
    pendingShowMainWindow = true;
    return;
  }
  showMainWindow();
  if (!overlayWindow || overlayWindow.isDestroyed()) createOverlayWindow();
});

app.on("before-quit", (event) => {
  isQuitting = true;
  if (historyWriteQueue?.pending() && !waitingForHistoryFlush) {
    event.preventDefault();
    waitingForHistoryFlush = true;
    historyWriteQueue.flush().catch((error) => console.error("Could not flush transcription history:", error)).finally(() => {
      waitingForHistoryFlush = false;
      app.quit();
    });
  }
});
app.on("will-quit", () => {
  clearTaskbarPulse();
  stopShortcutMonitors();
  globalShortcut.unregisterAll();
  transcriptionService?.dispose().catch((error) => console.error("Could not dispose transcription service:", error));
  transcriptionMetricsStore?.flush().catch((error) => console.error("Could not flush transcription metrics:", error));
  inputStrategy.dispose?.();
  closeDb();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && isQuitting) app.quit();
});
