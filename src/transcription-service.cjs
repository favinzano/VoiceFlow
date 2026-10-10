const crypto = require("node:crypto");
const { resampleAudio, trimEdgeSilence } = require("./audio-quality.cjs");

function normalizeInferenceDevice(device, platform = process.platform) {
  return device === "dml" && platform === "win32" ? "dml" : "cpu";
}

function executionProvidersFor(device) {
  return device === "dml" ? ["dml", "cpu"] : ["cpu"];
}

function concatenateAudio(chunks) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const samples = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }
  return samples;
}

function serializeModelError(error, attempt) {
  return {
    at: new Date().toISOString(),
    attempt,
    name: String(error?.name || "Error"),
    code: error?.code ? String(error.code) : undefined,
    message: String(error?.message || error || "Unknown model error")
  };
}

function friendlyModelError(error) {
  const message = String(error?.message || error || "");
  if (/espacio insuficiente/i.test(message)) return message;
  if (/ENOSPC|no space left/i.test(message)) return "No hay espacio suficiente para preparar el modelo local.";
  if (/local files|not found|no such file|ENOENT|fetch/i.test(message)) {
    return "El paquete del modelo local no está instalado o está incompleto.";
  }
  return "No fue posible preparar el modelo local. Instala o valida el paquete offline desde Soporte.";
}

function createTranscriptionService(options) {
  const {
    userDataPath,
    resolveProfile,
    ensureModelCache,
    loadModelWithRetry,
    onProgress = () => {},
    onDownloadState = () => {},
    allowRemoteModels = false,
    importTransformers = () => import("@huggingface/transformers"),
    logger = console,
    idleUnloadMs = 0,
    setTimer = setTimeout,
    clearTimer = clearTimeout
  } = options;
  let transcriber;
  let transcriberProfile;
  let transcriberDevice;
  let transcriberRequestedDevice;
  let transcriberPromise;
  let loadingProfile;
  let loadingDevice;
  let lastModelLoadMs;
  let lastModelLoadAttempts = 0;
  let lastModelError;
  let lastDeviceFallback;
  let lastTranscriptionMetrics;
  let idleTimer;
  const sessions = new Map();

  function clearIdleTimer() {
    if (idleTimer === undefined) return;
    clearTimer(idleTimer);
    idleTimer = undefined;
  }

  async function unloadIfIdle() {
    idleTimer = undefined;
    if (sessions.size > 0 || transcriberPromise) return;
    await unloadTranscriber();
  }

  function armIdleTimer() {
    clearIdleTimer();
    if (!(idleUnloadMs > 0) || !transcriber || sessions.size > 0) return;
    idleTimer = setTimer(() => { unloadIfIdle().catch((error) => logger.warn("Idle model unload failed:", error)); }, idleUnloadMs);
    if (idleTimer && typeof idleTimer.unref === "function") idleTimer.unref();
  }

  async function unloadTranscriber() {
    const current = transcriber;
    transcriber = undefined;
    transcriberProfile = undefined;
    transcriberDevice = undefined;
    transcriberRequestedDevice = undefined;
    if (current && typeof current.dispose === "function") await current.dispose();
  }

  async function getTranscriber(profileId, requestedDevice = "cpu") {
    const profile = resolveProfile(profileId);
    const device = normalizeInferenceDevice(requestedDevice);
    if (transcriber && transcriberProfile === profile.id && transcriberRequestedDevice === device) return transcriber;
    if (transcriberPromise && loadingProfile === profile.id && loadingDevice === device) return transcriberPromise;
    if (transcriberPromise) {
      await transcriberPromise;
      return getTranscriber(profile.id, device);
    }

    loadingProfile = profile.id;
    loadingDevice = device;
    transcriberPromise = (async () => {
      const modelLoadStartedAt = performance.now();
      const { pipeline, env } = await importTransformers();
      env.cacheDir = await ensureModelCache(userDataPath, profile.id);
      env.allowLocalModels = true;
      env.allowRemoteModels = Boolean(allowRemoteModels);

      if (transcriber && typeof transcriber.dispose === "function") await transcriber.dispose();
      transcriber = undefined;
      transcriberProfile = undefined;
      transcriberDevice = undefined;
      transcriberRequestedDevice = undefined;

      const pipelineOptions = {
        dtype: profile.dtype,
        progress_callback: (progress) => {
          if (["initiate", "download", "progress"].includes(progress.status)) onDownloadState(true);
          if (progress.status === "ready") onDownloadState(false);
          onProgress({
            profile: profile.id,
            label: profile.shortLabel,
            status: progress.status,
            progress: Number.isFinite(progress.progress) ? progress.progress : null
          });
        }
      };
      let activeDevice = device;
      let nextTranscriber;
      try {
        nextTranscriber = await pipeline("automatic-speech-recognition", profile.model, {
          ...pipelineOptions,
          device,
          session_options: { executionProviders: executionProvidersFor(device) }
        });
        lastDeviceFallback = undefined;
      } catch (error) {
        if (device !== "dml") throw error;
        logger.warn("DirectML initialization failed; falling back to CPU:", error);
        activeDevice = "cpu";
        lastDeviceFallback = true;
        nextTranscriber = await pipeline("automatic-speech-recognition", profile.model, {
          ...pipelineOptions,
          device: "cpu",
          session_options: { executionProviders: executionProvidersFor("cpu") }
        });
      }
      transcriber = nextTranscriber;
      transcriberProfile = profile.id;
      transcriberDevice = activeDevice;
      transcriberRequestedDevice = device;
      lastModelLoadMs = Math.round(performance.now() - modelLoadStartedAt);
      return nextTranscriber;
    })();

    try {
      return await transcriberPromise;
    } catch (error) {
      transcriber = undefined;
      transcriberProfile = undefined;
      transcriberDevice = undefined;
      transcriberRequestedDevice = undefined;
      throw error;
    } finally {
      onDownloadState(false);
      transcriberPromise = undefined;
      loadingProfile = undefined;
      loadingDevice = undefined;
    }
  }

  async function prepare(profileId, requestedDevice = "cpu", maxAttempts = 2) {
    const result = await loadModelWithRetry(
      () => getTranscriber(profileId, requestedDevice),
      {
        maxAttempts,
        retryDelayMs: 300,
        onFailure: (error, attempt) => {
          lastModelError = serializeModelError(error, attempt);
          logger.error(`Local model load attempt ${attempt} failed:`, error);
        }
      }
    );
    lastModelLoadAttempts = result.attempts;
    lastModelError = undefined;
    return result.value;
  }

  function start(configuration = {}) {
    clearIdleTimer();
    const id = crypto.randomUUID();
    const profile = resolveProfile(configuration.profileId);
    const device = configuration.device || "cpu";
    const preparePromise = prepare(profile.id, device).then(
      (pipe) => ({ pipe }),
      (error) => ({ error })
    );
    sessions.set(id, {
      id,
      language: configuration.language || "spanish",
      profileId: profile.id,
      device,
      sampleRate: Number(configuration.sampleRate) || 16000,
      chunks: [],
      audioSamples: 0,
      startedAt: performance.now(),
      preparePromise,
      cancelled: false
    });
    return { id, engine: "transformers-js", streaming: false };
  }

  function pushAudio(sessionId, audio) {
    const session = sessions.get(sessionId);
    if (!session || session.cancelled) return false;
    const chunk = audio instanceof Float32Array ? audio : new Float32Array(audio);
    if (!chunk.length) return true;
    session.chunks.push(chunk.slice());
    session.audioSamples += chunk.length;
    return true;
  }

  async function finish(sessionId) {
    const session = sessions.get(sessionId);
    if (!session || session.cancelled) throw new Error("Transcription session is not active.");
    sessions.delete(sessionId);
    const profile = resolveProfile(session.profileId);
    try {
      return await transcribeSession(session, profile);
    } finally {
      armIdleTimer();
    }
  }

  async function transcribeSession(session, profile) {
    const capturedSamples = concatenateAudio(session.chunks);
    const resampledSamples = session.sampleRate === 16000 ? capturedSamples : resampleAudio(capturedSamples, session.sampleRate);
    const samples = trimEdgeSilence(resampledSamples);
    try {
      const startedAt = performance.now();
      const prepared = await session.preparePromise;
      if (prepared.error) throw prepared.error;
      const pipe = prepared.pipe;
      const inferenceStartedAt = performance.now();
      const output = await pipe(samples, {
        language: session.language,
        task: "transcribe",
        chunk_length_s: 30,
        stride_length_s: 5,
        ...profile.generation
      });
      const inferenceMs = Math.round(performance.now() - inferenceStartedAt);
      const totalMs = Math.round(performance.now() - startedAt);
      const audioSeconds = capturedSamples.length / session.sampleRate;
      lastTranscriptionMetrics = {
        engine: "transformers-js",
        model: profile.model,
        profile: profile.id,
        device: transcriberDevice,
        requestedDevice: normalizeInferenceDevice(session.device),
        language: session.language,
        audioMs: Math.round(audioSeconds * 1000),
        inferenceMs,
        modelWaitMs: totalMs - inferenceMs,
        modelLoadMs: totalMs - inferenceMs,
        realtimeFactor: Number((inferenceMs / 1000 / Math.max(audioSeconds, 0.1)).toFixed(2)),
        totalMs
      };
      return {
        text: output.text.trim(),
        metrics: lastTranscriptionMetrics,
        engine: "transformers-js",
        model: profile.model,
        device: transcriberDevice
      };
    } catch (error) {
      lastModelError = serializeModelError(error, lastModelLoadAttempts || 1);
      throw new Error(friendlyModelError(error));
    }
  }

  function cancel(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) return false;
    session.cancelled = true;
    sessions.delete(sessionId);
    armIdleTimer();
    return true;
  }

  async function transcribe(audio, language, profileId, device) {
    const session = start({ language, profileId, device, sampleRate: 16000 });
    pushAudio(session.id, audio);
    return finish(session.id);
  }

  async function reset() {
    clearIdleTimer();
    sessions.clear();
    await unloadTranscriber();
    transcriberPromise = undefined;
    loadingProfile = undefined;
    loadingDevice = undefined;
  }

  function health() {
    return {
      engine: "transformers-js",
      ready: Boolean(transcriber),
      profile: transcriberProfile || loadingProfile || "none",
      device: transcriberDevice || loadingDevice || "none",
      requestedDevice: transcriberRequestedDevice || loadingDevice || "none",
      loading: Boolean(transcriberPromise),
      activeSessions: sessions.size,
      lastDeviceFallback,
      lastModelLoadMs,
      lastModelLoadAttempts,
      lastModelError,
      lastTranscriptionMetrics
    };
  }

  return {
    cancel,
    dispose: reset,
    finish,
    health,
    prepare,
    pushAudio,
    reset,
    start,
    transcribe
  };
}

module.exports = {
  concatenateAudio,
  createTranscriptionService,
  executionProvidersFor,
  friendlyModelError,
  normalizeInferenceDevice,
  serializeModelError
};
