// Comprueba con el modelo real que la descarga por inactividad (PR #12) libera memoria y que
// el siguiente dictado vuelve a funcionar. Usa el mismo servicio que la app, con un tiempo de
// inactividad corto en lugar de 15 minutos.
//
// Uso:  node --expose-gc scripts/measure-idle-unload.cjs [--profile fast|balanced|accurate]
//                                                         [--idle-seconds 20] [--user-data <carpeta>]
//
// 100% local: solo lee la caché de modelos de la app (allowRemoteModels = false); si falta el
// modelo, falla en lugar de descargarlo. No guarda audio: usa ruido sintético.
const fs = require("node:fs");
const path = require("node:path");
const { createTranscriptionService } = require("../src/transcription-service.cjs");
const { resolveWhisperProfile } = require("../src/whisper-profiles.cjs");
const { ensureModelCache } = require("../src/model-storage.cjs");
const { loadModelWithRetry } = require("../src/model-recovery.cjs");

const DEFAULT_PROFILE = "balanced";
const DEFAULT_IDLE_SECONDS = 20;
const MIN_IDLE_SECONDS = 5;
const AUDIO_SECONDS = 4;
const SAMPLE_RATE = 16000;
const UNLOAD_POLL_MS = 500;
const UNLOAD_GRACE_MS = 30_000;
const SETTLE_MS = 2000;
const GOOD_RELEASE_PCT = 50;
const PARTIAL_RELEASE_PCT = 20;

function readOption(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function defaultUserData() {
  const appData = process.env.APPDATA;
  const candidate = appData ? path.join(appData, "felipe avinzano VoiceFlow") : undefined;
  return candidate && fs.existsSync(path.join(candidate, "models")) ? candidate : undefined;
}

function syntheticAudio() {
  let seed = 20261009;
  const random = () => {
    seed = (1103515245 * seed + 12345) % 2147483648;
    return seed / 2147483648;
  };
  return Float32Array.from({ length: SAMPLE_RATE * AUDIO_SECONDS }, (_, index) => (
    Math.sin((2 * Math.PI * 220 * index) / SAMPLE_RATE) * 0.05 + (random() * 2 - 1) * 0.02
  ));
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rssMb = () => Math.round(process.memoryUsage().rss / 1024 / 1024);

async function settledRssMb() {
  await wait(SETTLE_MS);
  if (typeof global.gc === "function") global.gc();
  await wait(250);
  return rssMb();
}

async function timed(task) {
  const startedAt = performance.now();
  const value = await task();
  return { value, ms: Math.round(performance.now() - startedAt) };
}

async function main() {
  const profileId = readOption("profile", DEFAULT_PROFILE);
  const idleSeconds = Number(readOption("idle-seconds", DEFAULT_IDLE_SECONDS));
  const userData = readOption("user-data", defaultUserData());
  if (!userData) {
    throw new Error("No encuentro la carpeta de datos de la app. Pásala con --user-data <carpeta> (contiene la subcarpeta models).");
  }
  if (!(idleSeconds >= MIN_IDLE_SECONDS)) {
    throw new Error(`--idle-seconds debe ser al menos ${MIN_IDLE_SECONDS}: con menos, el modelo se descarga mientras se mide su memoria.`);
  }
  const profile = resolveWhisperProfile(profileId);

  console.log(`Perfil: ${profile.shortLabel} (${profile.id}) | inactividad simulada: ${idleSeconds} s | datos: ${userData}`);
  if (typeof global.gc !== "function") console.log("Aviso: sin --expose-gc las cifras de memoria son menos precisas.");

  const service = createTranscriptionService({
    userDataPath: userData,
    resolveProfile: resolveWhisperProfile,
    ensureModelCache,
    loadModelWithRetry,
    allowRemoteModels: false,
    idleUnloadMs: idleSeconds * 1000,
    logger: { warn: console.warn, error: console.error }
  });
  const audio = syntheticAudio();
  const dictate = () => timed(() => service.transcribe(audio, "spanish", profile.id, "cpu"));

  const baselineMb = await settledRssMb();
  console.log("\n1/4 Primer dictado (carga el modelo)…");
  const first = await dictate();
  // The service arms its idle timer when the dictation ends, so count from here.
  const idleStartedAt = performance.now();
  const loadedMb = await settledRssMb();
  const readyAfterFirst = service.health().ready;

  console.log(`2/4 Esperando la descarga por inactividad (hasta ${Math.round((idleSeconds * 1000 + UNLOAD_GRACE_MS) / 1000)} s)…`);
  const deadline = idleStartedAt + idleSeconds * 1000 + UNLOAD_GRACE_MS;
  while (service.health().ready && performance.now() < deadline) await wait(UNLOAD_POLL_MS);
  const unloaded = !service.health().ready;
  const unloadAfterS = Number(((performance.now() - idleStartedAt) / 1000).toFixed(1));
  const unloadedMb = await settledRssMb();

  console.log("3/4 Dictado tras la descarga (recarga el modelo)…");
  const reload = await dictate();
  const reloadedMb = await settledRssMb();
  console.log("4/4 Dictado en caliente (referencia)…");
  const warm = await dictate();
  await service.dispose();

  const addedMb = loadedMb - baselineMb;
  const freedMb = loadedMb - unloadedMb;
  const freedPct = addedMb > 0 ? Math.round((100 * freedMb) / addedMb) : 0;
  const releaseVerdict = !unloaded ? "FALLA (el modelo no se descargó)"
    : freedPct >= GOOD_RELEASE_PCT ? "OK"
      : freedPct >= PARTIAL_RELEASE_PCT ? "PARCIAL (libera poco)" : "NO LIBERA MEMORIA";

  console.log("\nMemoria (RSS)");
  console.log(`  antes de cargar : ${baselineMb} MB`);
  console.log(`  modelo cargado  : ${loadedMb} MB   (+${addedMb} MB)`);
  console.log(`  tras descargar  : ${unloadedMb} MB   (${freedMb >= 0 ? "-" : "+"}${Math.abs(freedMb)} MB, ${freedPct}% de lo añadido)`);
  console.log(`  tras recargar   : ${reloadedMb} MB`);
  console.log("\nTiempos");
  console.log(`  primer dictado (carga) : ${first.ms} ms`);
  console.log(`  tras la descarga       : ${reload.ms} ms`);
  console.log(`  en caliente            : ${warm.ms} ms`);
  console.log(`  coste de la recarga    : ${reload.ms - warm.ms} ms extra en el primer dictado tras la pausa`);
  console.log("\nVeredicto");
  console.log(`  modelo cargado tras dictar : ${readyAfterFirst ? "sí" : "NO (inesperado)"}`);
  console.log(`  descarga por inactividad   : ${unloaded ? `sí, a los ${unloadAfterS} s` : "NO"}`);
  console.log(`  liberación de memoria      : ${releaseVerdict}`);
  console.log(`  dictado tras descargar     : ${typeof reload.value.text === "string" ? "funciona" : "FALLA"}`);
  console.log("\nNota: la memoria es RSS del proceso; el sistema puede conservar páginas ya liberadas, por lo que el porcentaje es una guía, no una garantía.");
}

main().catch((error) => {
  console.error(`\nNo se pudo medir: ${error.message}`);
  process.exit(1);
});
