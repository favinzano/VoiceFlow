// Mide los niveles de tu micrófono con el mismo worklet y detector que usa la app.
// Uso:  npx electron scripts/measure-voice-levels.cjs [--mic "texto del nombre"]
// Todo ocurre en local: el audio no se guarda ni sale del equipo, solo se calculan niveles RMS.
const path = require("node:path");
const { app, BrowserWindow, ipcMain, session } = require("electron");
const { createVoiceActivityDetector } = require("../src/voice-activity.cjs");
const { evaluateSpeechGate, DEFAULT_MINIMUM_SPEECH_MS, DEFAULT_MINIMUM_RUN_MS } = require("../src/speech-gate.cjs");

const SPEECH_THRESHOLD = 0.008;
const COMFORTABLE_MARGIN = 2;
const NOISY_ROOM_P90 = 0.004;
const OVERALL_TIMEOUT_MS = 90_000;
const SPEECH_PHASES = ["voz-normal", "voz-baja", "voz-baja-ruido"];

const args = process.argv.slice(2);
const micArgIndex = args.indexOf("--mic");
const micFilter = micArgIndex >= 0 ? args[micArgIndex + 1] || "" : "";
if (args.includes("--fake-mic")) {
  // Solo para autocomprobar el montaje sin micrófono real: Chromium genera pitidos sintéticos.
  app.commandLine.appendSwitch("use-fake-device-for-media-stream");
  app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
}

function percentile(sortedValues, fraction) {
  if (!sortedValues.length) return 0;
  return sortedValues[Math.min(sortedValues.length - 1, Math.floor(sortedValues.length * fraction))];
}

function analyzePhase(samples) {
  const levels = samples.map(([, rms]) => rms).sort((a, b) => a - b);
  const intervals = samples.slice(1).map(([at], index) => at - samples[index][0]).sort((a, b) => a - b);
  // Same path as the app: the detector keeps the level history and the gate decides from it.
  const detector = createVoiceActivityDetector({ silenceTimeoutMs: Number.MAX_SAFE_INTEGER });
  samples.forEach(([at, rms]) => detector.update(rms, at));
  const gate = evaluateSpeechGate(detector.getLevels());
  return {
    count: levels.length,
    p50: percentile(levels, 0.5),
    p90: percentile(levels, 0.9),
    max: levels[levels.length - 1] ?? 0,
    aboveThresholdPct: levels.length ? (100 * levels.filter((rms) => rms >= SPEECH_THRESHOLD).length) / levels.length : 0,
    medianIntervalMs: percentile(intervals, 0.5),
    gate
  };
}

// The gate's effective level threshold adapts to each recording's noise floor, so the margin is
// measured in what the gate actually decides on: detected speech time against its minimum.
function hasMargin(stats) {
  return stats.gate.speechMs >= DEFAULT_MINIMUM_SPEECH_MS * COMFORTABLE_MARGIN;
}

function verdictFor(name, stats) {
  if (name === "ambiente") {
    if (stats.gate.hasSpeech) return "AVISO (el gate dejaría pasar solo este ruido)";
    return stats.p90 >= NOISY_ROOM_P90 ? "RUIDOSO (el piso de ruido es alto)" : "OK";
  }
  if (!stats.gate.hasSpeech) return "FALLA (el gate descartaría este dictado)";
  return hasMargin(stats) ? "OK" : "JUSTO (voz detectada menor a 2x el mínimo del gate)";
}

function fmt(value) {
  return value.toFixed(4);
}

function printReport(phases, info) {
  console.log(`\nMicrófono: ${info.deviceLabel}  |  sampleRate: ${info.sampleRate}`);
  console.log(`Entradas disponibles (usa --mic "texto" para elegir una):\n${info.devices.map((label) => `  - ${label}`).join("\n")}`);
  console.log(`Umbral de referencia del margen: ${SPEECH_THRESHOLD}  |  mínimo del gate: ${DEFAULT_MINIMUM_SPEECH_MS} ms en tramos de ${DEFAULT_MINIMUM_RUN_MS} ms o más\n`);
  const header = ["fase", "p50", "p90", "max", "% >= umbral", "cadencia", "voz (ms)", "veredicto"];
  const rows = Object.entries(phases).map(([name, stats]) => [
    name, fmt(stats.p50), fmt(stats.p90), fmt(stats.max), `${stats.aboveThresholdPct.toFixed(0)}%`,
    `${stats.medianIntervalMs} ms`, String(stats.gate.speechMs), verdictFor(name, stats)
  ]);
  const widths = header.map((title, index) => Math.max(title.length, ...rows.map((row) => row[index].length)));
  const line = (cells) => cells.map((cell, index) => cell.padEnd(widths[index])).join("  ");
  console.log(line(header));
  console.log(line(widths.map((width) => "-".repeat(width))));
  rows.forEach((row) => console.log(line(row)));

  const worst = SPEECH_PHASES.map((name) => phases[name]).filter(Boolean);
  const failing = worst.some((stats) => !stats.gate.hasSpeech);
  const tight = worst.some((stats) => !hasMargin(stats));
  console.log(
    failing ? "\nRESULTADO: el gate descartaría tu voz. Hay que parar y decidir antes de seguir con T6."
      : tight ? "\nRESULTADO: pasa, pero con poco margen. Conviene decidir antes de seguir con T6."
        : "\nRESULTADO: tu voz normal, baja y baja con ruido de fondo pasa el gate con margen. Se puede seguir con T6."
  );
}

function fail(message) {
  console.error(`\nNo se pudo medir: ${message}`);
  console.error("Revisa Configuración de Windows > Privacidad > Micrófono (permitir apps de escritorio).");
  app.exit(1);
}

app.whenReady().then(() => {
  const collected = {};
  let window;
  // Only this tool's own window may use the microphone.
  const isOwnWindow = (contents) => Boolean(window) && contents === window.webContents;
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(permission === "media" && isOwnWindow(contents)));
  session.defaultSession.setPermissionCheckHandler((contents, permission) => permission === "media" && isOwnWindow(contents));

  window = new BrowserWindow({
    width: 620,
    height: 400,
    title: "Medición de niveles de voz",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "measure-voice-levels-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  const timeout = setTimeout(() => fail("tiempo agotado esperando al micrófono"), OVERALL_TIMEOUT_MS);
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.on("closed", () => {
    clearTimeout(timeout);
    app.quit();
  });

  ipcMain.on("measure:phase", (_event, name, samples) => {
    collected[name] = analyzePhase(samples);
    console.log(`Fase "${name}" capturada (${samples.length} muestras).`);
  });
  ipcMain.on("measure:done", (_event, info) => {
    clearTimeout(timeout);
    printReport(collected, info);
    app.quit();
  });
  ipcMain.on("measure:fail", (_event, message) => {
    clearTimeout(timeout);
    fail(message);
  });

  window.loadFile(path.join(__dirname, "measure-voice-levels.html"), { query: { mic: micFilter } });
});
