const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const { cleanTranscription } = require("./text-cleanup.cjs");
const { resampleAudio, trimEdgeSilence } = require("./audio-quality.cjs");
const { createVoiceActivityDetector } = require("./voice-activity.cjs");
const { resolveWhisperProfile } = require("./whisper-profiles.cjs");
const { clearMigratedLegacyStorage, initializeProductionProfile, upgradeAccuracyDefault, upgradePerfDefault, revertExperimentalDmlDefault, revertWhisperCppEngine } = require("./data-migrations.cjs");
const { initializeVisualizer } = require("./audio-visualizer.js");
const { PASTE_FAILURE_REASON } = require("./paste-failure-reason.cjs");
const { normalizePlatformSettings, resolvePlatformCapabilities } = require("./platform-capabilities.cjs");

const voiceAPI = window.voiceAPI || {
  brand: {
    displayName: "felipe avinzano VoiceFlow",
    baseName: "felipe avinzano Voice",
    suffix: "Flow",
    copper: "#B87333"
  },
  runtime: {
    isPackaged: false,
    platform: "browser",
    capabilities: resolvePlatformCapabilities("browser", false),
    preserveLegacyStorage: false
  },
  appVersion: "0.0.0-dev",
  copy: async (text) => navigator.clipboard?.writeText(text),
  paste: async (text) => {
    try {
      await navigator.clipboard?.writeText(text);
      return { ok: true };
    } catch {
      return { ok: false, reason: PASTE_FAILURE_REASON.AUTOMATION_UNAVAILABLE };
    }
  },
  notifyPastePermissionDenied: async () => {},
  exportHistory: async () => false,
  getState: async () => ({ settings: {}, history: [], dictionary: [], microphone: "" }),
  migrateLegacyState: async (state) => state,
  writeState: async (state) => state,
  transcriptions: {
    getAll: async () => [],
    add: async (texto) => ({ id: crypto.randomUUID(), texto, fecha: new Date().toISOString() }),
    delete: async () => {},
    clear: async () => {},
    trim: async () => {},
    migrateLegacy: async () => {}
  },
  transcribe: async () => { throw new Error("La transcripción requiere la aplicación de escritorio."); },
  transcription: {
    start: async () => ({ id: crypto.randomUUID(), engine: "browser", streaming: false }),
    pushAudio: () => {},
    finish: async () => { throw new Error("La transcripción requiere la aplicación de escritorio."); },
    cancel: async () => false
  },
  deliver: async (text, options) => {
    if (options.copy) await navigator.clipboard?.writeText(text);
    return { pasted: Boolean(options.paste), row: null, metrics: {} };
  },
  metrics: { record: async () => {}, summary: async () => ({ count: 0 }) },
  overlay: async () => {},
  sendAudioData: () => {},
  taskbar: async () => {},
  diagnostics: async () => ({ platform: "browser", version: "preview" }),
  clearModels: async () => true,
  repairModels: async (profile, device) => ({ profile, device, cacheMb: 0, cacheRebuilt: false }),
  modelPacks: { list: async () => [], install: async () => ({ canceled: true }) },
  legal: {
    getStatus: async () => ({ accepted: true, currentTermsVersion: "browser-preview", acceptance: null }),
    acceptCurrentTerms: async () => ({ accepted: true }),
    declineCurrentTerms: async () => {},
    readDocument: async (type, language) => ({ type, language, content: "# Documento no disponible\n\nAbre la aplicación de escritorio para consultar este documento." }),
    contact: async () => {}
  },
  eraseLocalPersonalData: async () => ({ removed: [] }),
  getCloseBehavior: async () => "ask",
  setCloseBehavior: async () => "ask",
  getAutoStart: async () => false,
  setAutoStart: async () => false,
  getShortcuts: async () => ({ record: "CommandOrControl+Shift+Space", reprocess: "CommandOrControl+Alt+Space" }),
  setShortcuts: async (shortcuts) => shortcuts,
  getShortcutMode: async () => "toggle",
  setShortcutMode: async (mode) => mode,
  onShortcutToggle: () => {},
  onShortcutPressed: () => {},
  onShortcutReleased: () => {},
  onReprocess: () => {},
  onShortcutError: () => {},
  onModelProgress: () => {},
  onNavigate: () => {},
  onPasteLast: () => {}
};

const brand = voiceAPI.brand;

function applyBrand(brand, appVersion) {
  document.title = brand.displayName;
  document.querySelectorAll("[data-brand-base]").forEach((target) => {
    target.textContent = brand.baseName;
  });
  document.querySelectorAll("[data-brand-suffix]").forEach((target) => {
    target.textContent = brand.suffix;
  });
  document.querySelectorAll("[data-app-version]").forEach((target) => {
    target.textContent = appVersion;
  });
  document.querySelectorAll("[data-brand-label]").forEach((target) => {
    const suffixTemplate = target.getAttribute("data-brand-label-suffix-template") || "";
    const labelSuffix = suffixTemplate.replace("{version}", appVersion);
    target.setAttribute("aria-label", `${brand.displayName}${labelSuffix}`);
  });
}

applyBrand(brand, voiceAPI.appVersion);

// Exposes the OS to CSS so the title bar can dodge the platform's window
// controls: macOS draws its traffic lights top-left, Windows its controls
// top-right. Set synchronously (before first paint) to avoid a reflow flash.
document.documentElement.dataset.platform = voiceAPI.runtime.platform;

if (!voiceAPI.runtime.preserveLegacyStorage) {
  initializeProductionProfile(localStorage, voiceAPI.runtime.isPackaged);
  upgradeAccuracyDefault(localStorage);
}

const defaults = {
  language: "spanish",
  transcriptionMode: "auto",
  transcriptionEngine: "transformers-js",
  whisperProfile: "balanced",
  inferenceDevice: "cpu",
  deliveryMode: "paste-copy",
  appendSpace: true,
  cleanupText: true,
  dictionaryEnabled: true,
  historyLimit: 30,
  autoStopEnabled: true,
  silenceTimeoutMs: 1800,
  shortcutMode: "toggle",
  autoStartEnabled: true
};

const legacyState = {
  settings: JSON.parse(localStorage.getItem("voice-settings") || "{}"),
  history: JSON.parse(localStorage.getItem("voice-history") || "[]"),
  dictionary: JSON.parse(localStorage.getItem("voice-dictionary") || "[]"),
  microphone: localStorage.getItem("voice-microphone") || ""
};
let settings = { ...defaults, ...legacyState.settings };
let history = [];
let dictionary = legacyState.dictionary;
let persistedMicrophone = legacyState.microphone;
let mediaStream;
let audioContext;
let audioSource;
let captureNode;
let silentGain;
let recordedPcmChunks = [];
let lastAudio;
let recording = false;
let processing = false;
let timerInterval;
let startedAt;
let triggerSource = "button";
let overlayHideTimer;
let autoStopPending = false;
let voiceActivityDetector;
let availableMicrophones = [];
let persistQueue = Promise.resolve();
let holdShortcutPressed = false;
let legalReady = false;
let transcriptionSessionId;
let captureFlushResolver;
let captureFinishedAtEpochMs;

const elements = {
  recordButton: $("#recordButton"),
  recorderStage: $("#recorderStage"),
  headline: $("#headline"),
  stateLabel: $("#stateLabel"),
  timer: $("#timer"),
  waveform: $("#waveform"),
  modelBadge: $("#modelBadge"),
  historyList: $("#historyList"),
  historySearch: $("#historySearch"),
  exportHistory: $("#exportHistory"),
  clearHistory: $("#clearHistory"),
  reprocessButton: $("#reprocessButton"),
  dictionaryForm: $("#dictionaryForm"),
  dictionaryInput: $("#dictionaryInput"),
  dictionaryCounter: $("#dictionaryCounter"),
  dictionaryList: $("#dictionaryList"),
  microphone: $("#microphoneSelect"),
  language: $("#languageSelect"),
  transcriptionMode: $("#transcriptionMode"),
  transcriptionEngine: $("#transcriptionEngine"),
  whisperProfile: $("#whisperProfile"),
  inferenceDevice: $("#inferenceDevice"),
  inferenceDeviceDescription: $("#inferenceDeviceDescription"),
  deliveryMode: $("#deliveryMode"),
  appendSpace: $("#appendSpace"),
  cleanupText: $("#cleanupText"),
  dictionaryEnabled: $("#dictionaryEnabled"),
  historyLimit: $("#historyLimit"),
  autoStopEnabled: $("#autoStopEnabled"),
  silenceTimeout: $("#silenceTimeout"),
  autoStartEnabled: $("#autoStartEnabled"),
  autoStartTitle: $("#autoStartTitle"),
  autoStartDescription: $("#autoStartDescription"),
  closeBehavior: $("#closeBehavior"),
  shortcutMode: $("#shortcutMode"),
  shortcutModeDescription: $("#shortcutModeDescription"),
  recordShortcut: $("#recordShortcut"),
  reprocessShortcut: $("#reprocessShortcut"),
  diagnosticsButton: $("#diagnosticsButton"),
  repairModelsButton: $("#repairModelsButton"),
  installModelPackButton: $("#installModelPackButton"),
  performanceSummary: $("#performanceSummary"),
  performanceDetails: $("#performanceDetails"),
  checkUpdatesButton: $("#checkUpdatesButton"),
  restartUpdateButton: $("#restartUpdateButton"),
  legalGate: $("#legalGate"),
  acceptTermsCheckbox: $("#acceptTermsCheckbox"),
  acceptTermsButton: $("#acceptTermsButton"),
  declineTermsButton: $("#declineTermsButton"),
  gateTermsEsButton: $("#gateTermsEsButton"),
  gateTermsEnButton: $("#gateTermsEnButton"),
  gatePrivacyEsButton: $("#gatePrivacyEsButton"),
  gatePrivacyEnButton: $("#gatePrivacyEnButton"),
  legalDocumentModal: $("#legalDocumentModal"),
  legalDocumentTitle: $("#legalDocumentTitle"),
  legalDocumentContent: $("#legalDocumentContent"),
  closeLegalDocumentButton: $("#closeLegalDocumentButton"),
  termsEsButton: $("#termsEsButton"),
  termsEnButton: $("#termsEnButton"),
  privacyEsButton: $("#privacyEsButton"),
  privacyEnButton: $("#privacyEnButton"),
  licensesButton: $("#licensesButton"),
  aiActButton: $("#aiActButton"),
  legalContactButton: $("#legalContactButton"),
  erasePersonalDataButton: $("#erasePersonalDataButton"),
  toast: $("#toast")
};

function saveSettings() {
  persistState();
}

const platformNames = Object.freeze({ win32: "Windows", darwin: "macOS", linux: "Linux", browser: "el navegador" });

function applyPlatformCapabilities() {
  const capabilities = voiceAPI.runtime.capabilities
    || resolvePlatformCapabilities(voiceAPI.runtime.platform, voiceAPI.runtime.isPackaged);
  settings = normalizePlatformSettings(settings, capabilities);

  const dmlOption = elements.inferenceDevice.querySelector('option[value="dml"]');
  const supportsDml = capabilities.inferenceDevices.includes("dml");
  dmlOption.hidden = !supportsDml;
  dmlOption.disabled = !supportsDml;
  elements.inferenceDeviceDescription.textContent = supportsDml
    ? "DirectML usa la GPU de Windows y vuelve a CPU si no es compatible."
    : "CPU es el motor local compatible con esta plataforma.";

  const holdOption = elements.shortcutMode.querySelector('option[value="hold"]');
  const supportsHold = capabilities.shortcutModes.includes("hold");
  holdOption.hidden = !supportsHold;
  holdOption.disabled = !supportsHold;
  elements.shortcutModeDescription.textContent = supportsHold
    ? "Alternar inicia y detiene con cada pulsación. Mantener graba hasta soltar."
    : "Alternar inicia y detiene la grabación con cada pulsación.";

  const platformName = platformNames[voiceAPI.runtime.platform] || "el sistema";
  elements.autoStartTitle.textContent = `Iniciar con ${platformName}`;
  elements.autoStartDescription.textContent = capabilities.autoStart
    ? `Abre ${brand.displayName} silenciosamente al iniciar sesión.`
    : "Disponible únicamente en una aplicación instalada.";
  elements.autoStartEnabled.disabled = !capabilities.autoStart;

  if (voiceAPI.runtime.platform === "darwin") {
    [elements.recordShortcut, elements.reprocessShortcut].forEach((control) => {
      [...control.options].forEach((option) => { option.textContent = option.textContent.replaceAll("Ctrl", "Cmd"); });
    });
  }
}

function persistState() {
  const snapshot = {
    settings: { ...settings },
    history: [],
    dictionary: [...dictionary],
    microphone: persistedMicrophone
  };
  persistQueue = persistQueue.then(() => voiceAPI.writeState(snapshot)).catch((error) => {
    console.error("Could not persist local state:", error);
  });
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => elements.toast.classList.remove("show"), 2600);
}

const LEGAL_DOCUMENT_TITLES = Object.freeze({
  "terms:es": "Términos de uso",
  "terms:en": "Terms of Use",
  "privacy:es": "Política de privacidad",
  "privacy:en": "Privacy Policy",
  "licenses:es": "Avisos de terceros",
  "ai-act:es": "Evaluación del AI Act"
});

let legalDocumentReturnFocus;

function renderLegalMarkdown(markdown) {
  elements.legalDocumentContent.replaceChildren();
  let list;
  for (const sourceLine of String(markdown || "").split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line) {
      list = undefined;
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      list = undefined;
      const node = document.createElement(`h${heading[1].length}`);
      node.textContent = heading[2];
      elements.legalDocumentContent.append(node);
      continue;
    }
    if (line.startsWith("- ")) {
      if (!list) {
        list = document.createElement("ul");
        elements.legalDocumentContent.append(list);
      }
      const item = document.createElement("li");
      item.textContent = line.slice(2);
      list.append(item);
      continue;
    }
    list = undefined;
    const node = document.createElement(line.startsWith("> ") ? "blockquote" : "p");
    node.textContent = line.startsWith("> ") ? line.slice(2) : line;
    elements.legalDocumentContent.append(node);
  }
}

async function openLegalDocument(type, language = "es", trigger) {
  legalDocumentReturnFocus = trigger || document.activeElement;
  elements.legalDocumentTitle.textContent = LEGAL_DOCUMENT_TITLES[`${type}:${language}`] || "Documento legal";
  elements.legalDocumentContent.replaceChildren();
  const loading = document.createElement("p");
  loading.textContent = "Cargando copia local…";
  elements.legalDocumentContent.append(loading);
  elements.legalDocumentModal.hidden = false;
  try {
    const documentData = await voiceAPI.legal.readDocument(type, language);
    renderLegalMarkdown(documentData.content);
    elements.legalDocumentContent.focus();
  } catch (error) {
    renderLegalMarkdown(`# No se pudo abrir el documento\n\n${error.message || error}`);
  }
}

function closeLegalDocument() {
  elements.legalDocumentModal.hidden = true;
  legalDocumentReturnFocus?.focus?.();
}

async function ensureLegalAcceptance() {
  const status = await voiceAPI.legal.getStatus();
  if (status.accepted) {
    legalReady = true;
    return;
  }
  elements.legalGate.hidden = false;
  elements.acceptTermsCheckbox.checked = false;
  elements.acceptTermsButton.disabled = true;
  elements.acceptTermsCheckbox.focus();
  await new Promise((resolve) => {
    const accept = async () => {
      elements.acceptTermsButton.disabled = true;
      try {
        await voiceAPI.legal.acceptCurrentTerms();
        legalReady = true;
        elements.legalGate.hidden = true;
        elements.acceptTermsButton.removeEventListener("click", accept);
        resolve();
      } catch (error) {
        elements.acceptTermsButton.disabled = !elements.acceptTermsCheckbox.checked;
        showToast(`No fue posible registrar la aceptación: ${error.message || error}`);
      }
    };
    elements.acceptTermsButton.addEventListener("click", accept);
  });
}

function armTwoStepConfirm(button, confirmLabel, onConfirm, guard) {
  const restLabel = button.textContent;
  let armed = false;
  let revertTimer = null;
  button.addEventListener("click", () => {
    if (guard && !guard()) return;
    if (!armed) {
      armed = true;
      button.classList.add("confirming");
      button.textContent = confirmLabel;
      revertTimer = setTimeout(() => {
        armed = false;
        button.classList.remove("confirming");
        button.textContent = restLabel;
      }, 3200);
      return;
    }
    clearTimeout(revertTimer);
    armed = false;
    button.classList.remove("confirming");
    button.textContent = restLabel;
    onConfirm();
  });
}

function updateOverlay(status, message, timer = "") {
  clearTimeout(overlayHideTimer);
  voiceAPI.overlay({ status, message, timer });
}

function finishOverlay(status, message) {
  updateOverlay(status, message);
  overlayHideTimer = setTimeout(() => voiceAPI.overlay({ status: "idle" }), status === "error" ? 1800 : 1050);
}

function switchPanel(name) {
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.panel === name));
  $$(".panel").forEach((panel) => panel.classList.toggle("active", panel.id === `${name}Panel`));
}

function formatTime(totalSeconds) {
  return `${Math.floor(totalSeconds / 60).toString().padStart(2, "0")}:${Math.floor(totalSeconds % 60).toString().padStart(2, "0")}`;
}

function setStatus(status, detail) {
  voiceAPI.taskbar({ status });
  elements.recorderStage.dataset.status = status;
  elements.stateLabel.textContent = detail;
  elements.recordButton.disabled = status === "processing";
  const headlines = {
    idle: "Listo para capturar tu idea.",
    recording: "Tu idea está tomando forma.",
    processing: "Convirtiendo voz en el siguiente paso."
  };
  elements.headline.textContent = headlines[status];
}

let stopMainVisualizer;

async function releaseAudioCapture() {
  stopMainVisualizer?.();
  stopMainVisualizer = undefined;
  audioSource?.disconnect();
  captureNode?.disconnect();
  silentGain?.disconnect();
  mediaStream?.getTracks().forEach((track) => track.stop());
  await audioContext?.close();
  mediaStream = undefined;
  audioContext = undefined;
  audioSource = undefined;
  captureNode = undefined;
  silentGain = undefined;
  voiceActivityDetector = undefined;
}

async function updateMicrophones() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const microphones = devices.filter((device) => device.kind === "audioinput");
  availableMicrophones = microphones;
  const selected = persistedMicrophone;
  elements.microphone.innerHTML = '<option value="">Micrófono predeterminado</option>';
  microphones.forEach((microphone, index) => {
    const option = document.createElement("option");
    option.value = microphone.deviceId;
    option.textContent = microphone.label || `Micrófono ${index + 1}`;
    elements.microphone.appendChild(option);
  });
  if ([...elements.microphone.options].some((option) => option.value === selected)) elements.microphone.value = selected;
}

async function beginRecording(source = "button") {
  if (!legalReady) {
    showToast("Acepta los Términos antes de usar el micrófono.");
    return;
  }
  if (recording || processing) return;
  triggerSource = source;
  try {
    const selectedMicrophone = elements.microphone.value;
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(selectedMicrophone ? { deviceId: { exact: selectedMicrophone } } : {}),
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });
    await updateMicrophones();
    recordedPcmChunks = [];
    autoStopPending = false;
    voiceActivityDetector = createVoiceActivityDetector({ silenceTimeoutMs: Number(settings.silenceTimeoutMs) });
    audioContext = new AudioContext({ sampleRate: 16000, latencyHint: "interactive" });
    await audioContext.audioWorklet.addModule("src/pcm-capture-worklet.js");
    const profile = resolveWhisperProfile(settings.whisperProfile);
    const session = await voiceAPI.transcription.start({
      language: settings.language,
      mode: settings.transcriptionMode,
      engine: settings.transcriptionMode === "auto" ? "auto" : settings.transcriptionEngine,
      profileId: profile.id,
      device: settings.inferenceDevice,
      sampleRate: audioContext.sampleRate
    });
    transcriptionSessionId = session.id;
    audioSource = audioContext.createMediaStreamSource(mediaStream);
    captureNode = new AudioWorkletNode(audioContext, "voiceflow-pcm-capture");
    silentGain = audioContext.createGain();
    silentGain.gain.value = 0;
    stopMainVisualizer = initializeVisualizer(elements.waveform, audioContext, audioSource, {
      onFrequencyData: (frequencyData) => voiceAPI.sendAudioData(frequencyData)
    });
    captureNode.port.onmessage = (event) => {
      if (event.data instanceof Float32Array && event.data.length) {
        recordedPcmChunks.push(event.data);
        if (transcriptionSessionId) voiceAPI.transcription.pushAudio(transcriptionSessionId, event.data);
        return;
      }
      if (event.data?.type === "flushed") {
        captureFlushResolver?.();
        captureFlushResolver = undefined;
        return;
      }
      if (event.data?.type === "level") handleVoiceLevel(event.data.rms);
    };
    audioSource.connect(captureNode);
    captureNode.connect(silentGain);
    silentGain.connect(audioContext.destination);
    await audioContext.resume();
    recording = true;
    startedAt = Date.now();
    elements.timer.textContent = "00:00";
    timerInterval = setInterval(() => {
      elements.timer.textContent = formatTime((Date.now() - startedAt) / 1000);
      const instruction = triggerSource === "shortcut"
        ? (settings.shortcutMode === "hold" ? "Escuchando. Suelta el atajo para convertir." : "Escuchando. Presiona el atajo para convertir.")
        : "Escuchando. Haz clic para convertir.";
      updateOverlay("recording", instruction, elements.timer.textContent);
    }, 250);
    setStatus("recording", settings.shortcutMode === "hold" ? "Habla con naturalidad. Suelta el atajo para convertir." : "Habla con naturalidad. Presiona de nuevo para convertir.");
    const instruction = triggerSource === "shortcut"
      ? (settings.shortcutMode === "hold" ? "Escuchando. Suelta el atajo para convertir." : "Escuchando. Presiona el atajo para convertir.")
      : "Escuchando. Haz clic para convertir.";
    updateOverlay("recording", instruction, "00:00");
  } catch (error) {
    console.error(error);
    if (transcriptionSessionId) await voiceAPI.transcription.cancel(transcriptionSessionId).catch(() => {});
    transcriptionSessionId = undefined;
    await releaseAudioCapture();
    setStatus("idle", "No pudimos acceder al micrófono.");
    showToast(`Micrófono no disponible: ${error.message || error.name}`);
    finishOverlay("error", "No pudimos acceder al micrófono.");
  }
}

function handleVoiceLevel(rms) {
  if (!recording) return;
  if (!settings.autoStopEnabled || autoStopPending) return;
  if (!voiceActivityDetector?.update(rms)) return;
  autoStopPending = true;
  showToast("Silencio detectado. Procesando grabación.");
  finishRecording();
}

function collectRecording() {
  const length = recordedPcmChunks.reduce((total, chunk) => total + chunk.length, 0);
  if (!length) throw new Error("El micrófono no produjo datos de audio.");
  const samples = new Float32Array(length);
  let offset = 0;
  for (const chunk of recordedPcmChunks) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }
  return trimEdgeSilence(resampleAudio(samples, audioContext?.sampleRate || 16000));
}

function flushCapture(timeoutMs = 250) {
  if (!captureNode) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(finish, timeoutMs);
    captureFlushResolver = finish;
    captureNode.port.postMessage("flush");
  });
}

function cleanText(text) {
  return cleanTranscription(text, {
    cleanup: settings.cleanupText,
    dictionaryEnabled: settings.dictionaryEnabled,
    dictionary,
    appendSpace: settings.appendSpace
  });
}

async function processAudio(audio, source = "button", sessionContext = {}) {
  if (!audio) {
    showToast("Todavía no hay una grabación para reprocesar.");
    finishOverlay("error", "Todavía no hay una grabación para reprocesar.");
    return;
  }
  processing = true;
  setStatus("processing", "Procesando localmente. Tu audio no sale de este equipo.");
  updateOverlay("processing", "Convirtiendo tu voz en texto.", "LOCAL");
  try {
    elements.modelBadge.classList.add("loading");
    elements.modelBadge.classList.remove("error");
    elements.modelBadge.innerHTML = "<span></span>Preparando motor local";
    const profile = resolveWhisperProfile(settings.whisperProfile);
    const ipcStartedAt = performance.now();
    const result = sessionContext.sessionId
      ? await voiceAPI.transcription.finish(sessionContext.sessionId)
      : await voiceAPI.transcribe(audio, settings.language, profile.id, settings.inferenceDevice);
    const rendererTranscriptionMs = Math.round(performance.now() - ipcStartedAt);
    if (sessionContext.sessionId === transcriptionSessionId) transcriptionSessionId = undefined;
    const textFinalizeStartedAt = performance.now();
    const rawText = typeof result === "string" ? result : result.text;
    if (!rawText) throw new Error("El motor no devolvió texto.");
    const text = cleanText(rawText);
    const textFinalizeMs = Math.round(performance.now() - textFinalizeStartedAt);
    if (!text.trim()) throw new Error("No detectamos palabras claras en la grabación.");
    elements.modelBadge.classList.remove("loading", "error");
    elements.modelBadge.innerHTML = `<span></span>${profile.shortLabel} · ${(result.device || "cpu").toUpperCase()}`;
    const delivery = await deliverText(text, source, sessionContext.captureFinishedAtEpochMs);
    finishOverlay(
      "success",
      delivery.pasted ? "Texto pegado. Continúa escribiendo." : "Transcripción copiada al portapapeles."
    );
    refreshHistory().catch((error) => console.error("Could not refresh transcription history:", error));
    if (result.metrics) {
      const metrics = {
        ...result.metrics,
        ...sessionContext.timings,
        ...delivery.metrics,
        ipcMs: Math.max(0, rendererTranscriptionMs - (result.metrics.totalMs || 0)),
        textFinalizeMs,
        pasted: delivery.pasted,
        success: true
      };
      renderPerformance(metrics).catch((error) => console.error("Could not render performance:", error));
      voiceAPI.metrics.record(metrics).catch((error) => console.error("Could not record transcription metrics:", error));
    }
  } catch (error) {
    console.error(error);
    if (sessionContext.sessionId) await voiceAPI.transcription.cancel(sessionContext.sessionId).catch(() => {});
    if (sessionContext.sessionId === transcriptionSessionId) transcriptionSessionId = undefined;
    elements.modelBadge.classList.remove("loading");
    elements.modelBadge.classList.add("error");
    elements.modelBadge.innerHTML = "<span></span>Motor no disponible";
    showToast(`No fue posible transcribir: ${error.message || error}`);
    finishOverlay("error", "No fue posible completar la transcripción.");
  } finally {
    processing = false;
    setStatus("idle", `Haz clic o usa ${voiceAPI.runtime.platform === "darwin" ? "Cmd" : "Ctrl"} + Shift + Espacio.`);
  }
}

async function renderPerformance(metrics) {
  const diagnostics = await voiceAPI.diagnostics();
  elements.performanceSummary.textContent = `${(metrics.totalMs / 1000).toFixed(1)} s total · ${metrics.realtimeFactor}x tiempo real`;
  const modelWaitMs = metrics.modelWaitMs ?? metrics.modelLoadMs ?? 0;
  const endToPaste = Number.isFinite(metrics.endToPasteMs) ? ` · fin a pegado ${(metrics.endToPasteMs / 1000).toFixed(2)} s` : "";
  elements.performanceDetails.textContent = `Inferencia ${(metrics.inferenceMs / 1000).toFixed(1)} s · espera ${(modelWaitMs / 1000).toFixed(1)} s${endToPaste} · memoria ${diagnostics.memoryRssMb} MB RSS`;
}

async function finishRecording() {
  if (!recording) return;
  const captureFinalizeStartedAt = performance.now();
  recording = false;
  processing = true;
  clearInterval(timerInterval);
  captureFinishedAtEpochMs = Date.now();
  const sessionId = transcriptionSessionId;
  await flushCapture();
  const preprocessStartedAt = performance.now();
  try {
    lastAudio = collectRecording();
  } catch (error) {
    processing = false;
    if (sessionId) await voiceAPI.transcription.cancel(sessionId).catch(() => {});
    if (sessionId === transcriptionSessionId) transcriptionSessionId = undefined;
    setStatus("idle", error.message);
    finishOverlay("error", "No pudimos procesar la grabación.");
    return;
  } finally {
    await releaseAudioCapture();
  }
  const timings = {
    preprocessMs: Math.round(performance.now() - preprocessStartedAt),
    captureFinalizeMs: Math.round(performance.now() - captureFinalizeStartedAt)
  };
  const peak = lastAudio.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
  if (lastAudio.length < 12000) {
    processing = false;
    if (sessionId) await voiceAPI.transcription.cancel(sessionId).catch(() => {});
    if (sessionId === transcriptionSessionId) transcriptionSessionId = undefined;
    setStatus("idle", "La grabación fue demasiado corta. Intenta de nuevo.");
    finishOverlay("error", "La grabación fue demasiado corta.");
    return;
  }
  if (peak < 0.002) {
    processing = false;
    if (sessionId) await voiceAPI.transcription.cancel(sessionId).catch(() => {});
    if (sessionId === transcriptionSessionId) transcriptionSessionId = undefined;
    setStatus("idle", "No detectamos voz. Revisa el micrófono seleccionado.");
    finishOverlay("error", "No detectamos voz. Revisa el micrófono.");
    return;
  }
  processing = false;
  await processAudio(lastAudio, triggerSource, { sessionId, captureFinishedAtEpochMs, timings });
}

function pasteFailureToastMessage(reason) {
  if (reason === PASTE_FAILURE_REASON.PERMISSION_DENIED) {
    return "No se pudo pegar: falta un permiso del sistema. El texto quedó en el portapapeles.";
  }
  return "No se pudo pegar automáticamente. El texto quedó guardado en el portapapeles.";
}

async function deliverText(text, source, finishedAtEpochMs) {
  const copy = settings.deliveryMode === "copy" || settings.deliveryMode === "paste-copy";
  const shouldPaste = settings.deliveryMode === "paste-copy" && source === "shortcut";
  const delivery = await voiceAPI.deliver(text, {
    copy,
    paste: shouldPaste,
    saveHistory: true,
    historyLimit: Number(settings.historyLimit),
    captureFinishedAtEpochMs: finishedAtEpochMs
  });
  if (shouldPaste) {
    if (delivery.pasted) {
      showToast("Texto pegado y guardado en el portapapeles.");
    } else {
      showToast(pasteFailureToastMessage(delivery.reason));
      if (delivery.reason === PASTE_FAILURE_REASON.PERMISSION_DENIED) {
        voiceAPI.notifyPastePermissionDenied().catch((error) => console.error("No se pudo mostrar el aviso de permisos:", error));
      }
    }
    return delivery;
  } else if (settings.deliveryMode === "copy") {
    showToast("Texto guardado en el portapapeles.");
  } else {
    showToast("Transcripción lista.");
  }
  return delivery;
}

async function refreshHistory() {
  const rows = await voiceAPI.transcriptions.getAll(Number(settings.historyLimit));
  history = rows.map((row) => ({ id: row.id, text: row.texto, at: row.fecha }));
  renderHistory();
}

function renderHistory() {
  elements.historyList.innerHTML = "";
  const query = elements.historySearch.value.trim().toLocaleLowerCase();
  const visibleHistory = query
    ? history.filter((item) => item.text.toLocaleLowerCase().includes(query))
    : history;
  if (!visibleHistory.length) {
    if (query) {
      elements.historyList.innerHTML = '<div class="empty-state"><span>Búsqueda local</span><h3>No encontramos coincidencias.</h3><p>Prueba con otra palabra o frase.</p></div>';
      return;
    }
    elements.historyList.innerHTML = '<div class="empty-state"><span>Archivo local</span><h3>Aún no hay transcripciones.</h3><p>Tu primera idea convertida en texto aparecerá aquí.</p></div>';
    return;
  }
  visibleHistory.forEach((item, index) => {
    const article = document.createElement("article");
    const date = new Date(item.at);
    article.className = "history-item";
    article.innerHTML = `<button class="history-copy" title="Copiar transcripción"><span></span><p></p></button><div class="history-meta"><time>${date.toLocaleString()}</time><button class="history-delete">Eliminar</button></div>`;
    article.querySelector(".history-copy span").textContent = `${String(index + 1).padStart(2, "0")} / Texto`;
    article.querySelector("p").textContent = item.text;
    article.querySelector(".history-copy").addEventListener("click", async () => {
      await voiceAPI.copy(item.text);
      showToast("Transcripción copiada.");
    });
    article.querySelector(".history-delete").addEventListener("click", async () => {
      await voiceAPI.transcriptions.delete(item.id);
      await refreshHistory();
    });
    elements.historyList.appendChild(article);
  });
}

function renderDictionary() {
  elements.dictionaryList.innerHTML = "";
  if (!dictionary.length) {
    elements.dictionaryList.innerHTML = '<div class="empty-state compact"><span>Diccionario personal</span><h3>Empieza con una palabra importante.</h3><p>Nombres propios, marcas y términos técnicos son un buen comienzo.</p></div>';
    return;
  }
  dictionary.forEach((term, index) => {
    const row = document.createElement("div");
    row.className = "dictionary-item";
    row.innerHTML = `<span>${String(index + 1).padStart(2, "0")}</span><strong></strong><em>Activo</em><button>Eliminar</button>`;
    row.querySelector("strong").textContent = term;
    row.querySelector("button").addEventListener("click", () => {
      dictionary = dictionary.filter((item) => item !== term);
      persistState();
      renderDictionary();
    });
    elements.dictionaryList.appendChild(row);
  });
}

async function hydrateSettings() {
  const profile = resolveWhisperProfile(settings.whisperProfile);
  elements.language.value = settings.language;
  elements.transcriptionMode.value = settings.transcriptionMode === "advanced" ? "advanced" : "auto";
  elements.transcriptionEngine.value = settings.transcriptionEngine;
  elements.whisperProfile.value = profile.id;
  elements.inferenceDevice.value = settings.inferenceDevice;
  syncAdvancedTranscriptionControls();
  elements.modelBadge.innerHTML = `<span></span>${profile.label} seleccionado`;
  elements.deliveryMode.value = settings.deliveryMode;
  elements.appendSpace.checked = settings.appendSpace;
  elements.cleanupText.checked = settings.cleanupText;
  elements.dictionaryEnabled.checked = settings.dictionaryEnabled;
  elements.historyLimit.value = String(settings.historyLimit);
  elements.autoStopEnabled.checked = settings.autoStopEnabled;
  elements.silenceTimeout.value = String(settings.silenceTimeoutMs);
  const shortcuts = await voiceAPI.getShortcuts();
  elements.recordShortcut.value = shortcuts.record;
  elements.reprocessShortcut.value = shortcuts.reprocess;
  settings.shortcutMode = await voiceAPI.getShortcutMode();
  elements.shortcutMode.value = settings.shortcutMode;
  settings.autoStartEnabled = await voiceAPI.getAutoStart();
  elements.autoStartEnabled.checked = settings.autoStartEnabled;
  saveSettings();
  elements.closeBehavior.value = await voiceAPI.getCloseBehavior();
}

function syncAdvancedTranscriptionControls() {
  const advanced = settings.transcriptionMode === "advanced";
  elements.transcriptionEngine.disabled = !advanced;
  elements.whisperProfile.disabled = !advanced;
  const capabilities = voiceAPI.runtime.capabilities
    || resolvePlatformCapabilities(voiceAPI.runtime.platform, voiceAPI.runtime.isPackaged);
  elements.inferenceDevice.disabled = !advanced || capabilities.inferenceDevices.length < 2;
}

function toggleRecording(source = "button") {
  if (!legalReady) {
    showToast("Acepta los Términos antes de usar el micrófono.");
    return;
  }
  if (recording) finishRecording();
  else beginRecording(source);
}

$$(".nav-item").forEach((button) => button.addEventListener("click", () => switchPanel(button.dataset.panel)));
elements.acceptTermsCheckbox.addEventListener("change", () => {
  elements.acceptTermsButton.disabled = !elements.acceptTermsCheckbox.checked;
});
elements.declineTermsButton.addEventListener("click", () => voiceAPI.legal.declineCurrentTerms());
elements.gateTermsEsButton.addEventListener("click", () => openLegalDocument("terms", "es", elements.gateTermsEsButton));
elements.gateTermsEnButton.addEventListener("click", () => openLegalDocument("terms", "en", elements.gateTermsEnButton));
elements.gatePrivacyEsButton.addEventListener("click", () => openLegalDocument("privacy", "es", elements.gatePrivacyEsButton));
elements.gatePrivacyEnButton.addEventListener("click", () => openLegalDocument("privacy", "en", elements.gatePrivacyEnButton));
elements.termsEsButton.addEventListener("click", () => openLegalDocument("terms", "es", elements.termsEsButton));
elements.termsEnButton.addEventListener("click", () => openLegalDocument("terms", "en", elements.termsEnButton));
elements.privacyEsButton.addEventListener("click", () => openLegalDocument("privacy", "es", elements.privacyEsButton));
elements.privacyEnButton.addEventListener("click", () => openLegalDocument("privacy", "en", elements.privacyEnButton));
elements.licensesButton.addEventListener("click", () => openLegalDocument("licenses", "es", elements.licensesButton));
elements.aiActButton.addEventListener("click", () => openLegalDocument("ai-act", "es", elements.aiActButton));
elements.legalContactButton.addEventListener("click", () => voiceAPI.legal.contact());
elements.closeLegalDocumentButton.addEventListener("click", closeLegalDocument);
elements.legalDocumentModal.addEventListener("click", (event) => {
  if (event.target === elements.legalDocumentModal) closeLegalDocument();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.legalDocumentModal.hidden) closeLegalDocument();
});
elements.recordButton.addEventListener("click", () => toggleRecording("button"));
elements.checkUpdatesButton.addEventListener("click", () => {
  voiceAPI.checkForUpdates();
});
elements.restartUpdateButton.addEventListener("click", () => {
  voiceAPI.installUpdate();
});
elements.reprocessButton.addEventListener("click", () => processAudio(lastAudio, "button"));
armTwoStepConfirm(elements.clearHistory, "¿Confirmar borrado?", async () => {
  await voiceAPI.transcriptions.clear();
  await refreshHistory();
  showToast("Historial borrado.");
});
armTwoStepConfirm(
  elements.erasePersonalDataButton,
  "¿Borrar datos y reiniciar?",
  async () => {
    showToast("Borrando datos personales locales y reiniciando…");
    localStorage.clear();
    await voiceAPI.eraseLocalPersonalData();
  },
  () => {
    if (recording || processing) {
      showToast("Finaliza la grabación o el procesamiento antes de borrar los datos.");
      return false;
    }
    return true;
  }
);
elements.historySearch.addEventListener("input", renderHistory);
elements.exportHistory.addEventListener("click", async () => {
  if (!history.length) {
    showToast("Aún no hay transcripciones para exportar.");
    return;
  }
  const exported = await voiceAPI.exportHistory(history);
  showToast(exported ? "Historial exportado." : "Exportación cancelada.");
});
function updateDictionaryCounter() {
  const length = elements.dictionaryInput.value.length;
  const max = Number(elements.dictionaryInput.maxLength) || 80;
  elements.dictionaryCounter.textContent = `${length} / ${max}`;
  elements.dictionaryCounter.classList.toggle("near-limit", length >= max);
}
elements.dictionaryInput.addEventListener("input", updateDictionaryCounter);
elements.dictionaryForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const term = elements.dictionaryInput.value.trim();
  if (!term || dictionary.some((item) => item.toLocaleLowerCase() === term.toLocaleLowerCase())) return;
  dictionary.unshift(term);
  persistState();
  elements.dictionaryInput.value = "";
  updateDictionaryCounter();
  renderDictionary();
  showToast("Término añadido al diccionario.");
});
elements.microphone.addEventListener("change", () => {
  persistedMicrophone = elements.microphone.value;
  persistState();
  showToast("Micrófono seleccionado.");
});
[
  ["language", elements.language],
  ["transcriptionMode", elements.transcriptionMode],
  ["transcriptionEngine", elements.transcriptionEngine],
  ["whisperProfile", elements.whisperProfile],
  ["inferenceDevice", elements.inferenceDevice],
  ["deliveryMode", elements.deliveryMode],
  ["appendSpace", elements.appendSpace],
  ["cleanupText", elements.cleanupText],
  ["dictionaryEnabled", elements.dictionaryEnabled],
  ["historyLimit", elements.historyLimit],
  ["autoStopEnabled", elements.autoStopEnabled],
  ["silenceTimeoutMs", elements.silenceTimeout]
].forEach(([key, control]) => control.addEventListener("change", async () => {
  settings[key] = control.type === "checkbox" ? control.checked : control.value;
  if (key === "historyLimit" || key === "silenceTimeoutMs") settings[key] = Number(settings[key]);
  saveSettings();
  if (key === "whisperProfile") {
    const profile = resolveWhisperProfile(settings.whisperProfile);
    elements.modelBadge.classList.remove("loading", "error");
    elements.modelBadge.innerHTML = `<span></span>${profile.label} seleccionado`;
  }
  if (key === "historyLimit") {
    await voiceAPI.transcriptions.trim(settings.historyLimit);
    await refreshHistory();
  }
  showToast("Preferencia guardada.");
}));
elements.diagnosticsButton.addEventListener("click", async () => {
  try {
    const diagnostics = await voiceAPI.diagnostics();
    const report = [
      `${brand.displayName} diagnostics`,
      `Platform: ${diagnostics.platform ?? "—"}`,
      `Version: ${diagnostics.version ?? "—"}`,
      `Model status: ${elements.modelBadge.textContent.trim()}`,
      `Whisper profile selected: ${resolveWhisperProfile(settings.whisperProfile).shortLabel}`,
      `Whisper profile loaded: ${diagnostics.loadedWhisperProfile ?? "—"}`,
      `Inference device: ${diagnostics.inferenceDevice ?? "—"}`,
      `Requested inference device: ${diagnostics.requestedInferenceDevice ?? "—"}`,
      `Last device fallback: ${diagnostics.lastDeviceFallback || "none"}`,
      `Last model load attempts: ${diagnostics.lastModelLoadAttempts || 0}`,
      `Last model error: ${JSON.stringify(diagnostics.lastModelError || null)}`,
      `Model cache: ${diagnostics.modelCacheMb ?? "—"} MB`,
      `Memory RSS: ${diagnostics.memoryRssMb ?? "—"} MB`,
      `Heap used: ${diagnostics.heapUsedMb ?? "—"} MB`,
      `Record shortcut: ${diagnostics.shortcuts?.record ?? "—"}`,
      `Reprocess shortcut: ${diagnostics.shortcuts?.reprocess ?? "—"}`,
      `Record shortcut registered: ${Boolean(diagnostics.shortcutRegistered?.record)}`,
      `Reprocess shortcut registered: ${Boolean(diagnostics.shortcutRegistered?.reprocess)}`,
      `Shortcut mode: ${diagnostics.shortcutMode || settings.shortcutMode}`,
      `Last transcription metrics: ${JSON.stringify(diagnostics.lastTranscriptionMetrics || null)}`,
      `State schema: ${diagnostics.stateSchemaVersion ?? "—"}`,
      `State path: ${diagnostics.statePath ?? "—"}`,
      `Microphone selection: ${elements.microphone.value || "default"}`,
      `Microphones available: ${availableMicrophones.length}`,
      `Dictionary terms: ${dictionary.length}`,
      `History entries: ${history.length}`
    ].join("\n");
    await voiceAPI.copy(report);
    showToast("Diagnóstico copiado. No incluye transcripciones.");
  } catch (error) {
    showToast("No se pudo generar el diagnóstico.");
  }
});
armTwoStepConfirm(
  elements.repairModelsButton,
  "¿Confirmar reparación?",
  async () => {
    elements.modelBadge.classList.add("loading");
    elements.modelBadge.classList.remove("error");
    elements.modelBadge.innerHTML = "<span></span>Reparando modelos";
    try {
      const profile = resolveWhisperProfile(settings.whisperProfile);
      const repaired = await voiceAPI.repairModels(profile.id, settings.inferenceDevice);
      elements.modelBadge.classList.remove("loading", "error");
      elements.modelBadge.innerHTML = `<span></span>${profile.shortLabel} · ${(repaired.device || "cpu").toUpperCase()}`;
      showToast(repaired.cacheRebuilt
        ? `Modelo reparado y validado (${repaired.cacheMb} MB).`
        : `Modelo validado y listo (${repaired.cacheMb} MB).`);
    } catch (error) {
      elements.modelBadge.classList.remove("loading");
      elements.modelBadge.classList.add("error");
      elements.modelBadge.innerHTML = "<span></span>No fue posible reparar";
      showToast(`No fue posible reparar los modelos: ${error.message || error}`);
    }
  },
  () => {
    if (recording || processing) {
      showToast("Espera a que termine la grabación antes de reparar los modelos.");
      return false;
    }
    return true;
  }
);
elements.installModelPackButton.addEventListener("click", async () => {
  try {
    const result = await voiceAPI.modelPacks.install();
    if (result.canceled) return;
    const pack = result.pack;
    showToast(`Paquete ${pack.id} ${pack.version} instalado y verificado.`);
  } catch (error) {
    showToast(`No se pudo instalar el paquete: ${error.message || error}`);
  }
});
elements.closeBehavior.addEventListener("change", async () => {
  await voiceAPI.setCloseBehavior(elements.closeBehavior.value);
  showToast("Comportamiento de cierre guardado.");
});
elements.autoStartEnabled.addEventListener("change", async () => {
  const requested = elements.autoStartEnabled.checked;
  try {
    settings.autoStartEnabled = await voiceAPI.setAutoStart(requested);
    elements.autoStartEnabled.checked = settings.autoStartEnabled;
    saveSettings();
    const platformName = platformNames[voiceAPI.runtime.platform] || "el sistema";
    showToast(settings.autoStartEnabled ? `Inicio con ${platformName} activado.` : `Inicio con ${platformName} desactivado.`);
  } catch (error) {
    elements.autoStartEnabled.checked = settings.autoStartEnabled;
    showToast(`No fue posible cambiar el inicio automático: ${error.message || error}`);
  }
});
async function updateShortcuts() {
  const requested = {
    record: elements.recordShortcut.value,
    reprocess: elements.reprocessShortcut.value
  };
  try {
    const applied = await voiceAPI.setShortcuts(requested);
    elements.recordShortcut.value = applied.record;
    elements.reprocessShortcut.value = applied.reprocess;
    showToast("Atajos globales actualizados.");
  } catch (error) {
    const current = await voiceAPI.getShortcuts();
    elements.recordShortcut.value = current.record;
    elements.reprocessShortcut.value = current.reprocess;
    showToast(error.message || "No fue posible registrar los atajos.");
  }
}
elements.recordShortcut.addEventListener("change", updateShortcuts);
elements.reprocessShortcut.addEventListener("change", updateShortcuts);
elements.shortcutMode.addEventListener("change", async () => {
  const previous = settings.shortcutMode;
  try {
    settings.shortcutMode = await voiceAPI.setShortcutMode(elements.shortcutMode.value);
    elements.shortcutMode.value = settings.shortcutMode;
    saveSettings();
    showToast(settings.shortcutMode === "hold" ? "Mantén el atajo para grabar." : "Modo de atajo alternar activado.");
  } catch (error) {
    settings.shortcutMode = previous;
    elements.shortcutMode.value = previous;
    showToast(error.message || "No fue posible cambiar el modo del atajo.");
  }
});

voiceAPI.onShortcutToggle(() => toggleRecording("shortcut"));
voiceAPI.onShortcutPressed(async () => {
  holdShortcutPressed = true;
  if (!recording && !processing) await beginRecording("shortcut");
  if (!holdShortcutPressed && recording) finishRecording();
});
voiceAPI.onShortcutReleased(() => {
  holdShortcutPressed = false;
  if (recording) finishRecording();
});
voiceAPI.onReprocess(() => processAudio(lastAudio, "shortcut"));
voiceAPI.onShortcutError(() => showToast("Un acceso directo ya está siendo usado por otra aplicación."));
voiceAPI.onNavigate((panel) => switchPanel(panel));
voiceAPI.onUpdateDownloaded(() => {
  elements.restartUpdateButton.hidden = false;
  showToast("Actualización descargada. Reinicia para instalarla.");
});
voiceAPI.onPasteLast(async () => {
  if (!history.length) {
    showToast("Aún no hay transcripciones para pegar.");
    return;
  }
  const pasted = await voiceAPI.paste(history[0].text);
  if (pasted.ok) {
    showToast("Última transcripción pegada.");
  } else {
    showToast(pasteFailureToastMessage(pasted.reason));
    if (pasted.reason === PASTE_FAILURE_REASON.PERMISSION_DENIED) {
      voiceAPI.notifyPastePermissionDenied().catch((error) => console.error("No se pudo mostrar el aviso de permisos:", error));
    }
  }
});
voiceAPI.onModelProgress((progress) => {
  if (progress.status !== "progress" || !Number.isFinite(progress.progress)) return;
  const percent = Math.max(0, Math.min(100, Math.round(progress.progress)));
  elements.modelBadge.innerHTML = `<span></span>${progress.label || "Whisper"} ${percent}%`;
  elements.stateLabel.textContent = `Preparando ${progress.label || "el motor local"} por primera vez: ${percent}%`;
});

async function initializeApp() {
  await ensureLegalAcceptance();
  await voiceAPI.migrateLegacyState(legacyState);
  const persisted = await voiceAPI.getState();
  let migratedSettings = upgradePerfDefault(localStorage, persisted.settings);
  migratedSettings = revertExperimentalDmlDefault(localStorage, migratedSettings);
  migratedSettings = revertWhisperCppEngine(localStorage, migratedSettings);
  const perfDefaultsApplied = migratedSettings !== persisted.settings;
  persisted.settings = migratedSettings;
  settings = { ...defaults, ...persisted.settings };
  applyPlatformCapabilities();
  dictionary = persisted.dictionary;
  persistedMicrophone = persisted.microphone;
  clearMigratedLegacyStorage(localStorage, voiceAPI.runtime.preserveLegacyStorage);
  await voiceAPI.transcriptions.migrateLegacy(persisted.history);

  await hydrateSettings();
  await refreshHistory();
  renderDictionary();
  await updateMicrophones();
  const modifier = voiceAPI.runtime.platform === "darwin" ? "Cmd" : "Ctrl";
  setStatus("idle", `Haz clic o usa ${modifier} + Shift + Espacio.`);
  const primaryShortcutLabel = document.getElementById("primaryShortcutLabel");
  if (primaryShortcutLabel) primaryShortcutLabel.textContent = `${modifier} + Shift + Espacio`;
  document.documentElement.dataset.voiceflowInitialized = "true";
  if (perfDefaultsApplied) {
    persistState();
    showToast("Ajustamos el motor de transcripción para mayor estabilidad. Puedes cambiarlo en Configuración.");
  }
}

initializeApp().catch((error) => {
  console.error("Could not initialize application state:", error);
  showToast("No fue posible cargar los datos locales.");
});
