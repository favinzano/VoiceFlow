const assert = require("node:assert/strict");
const {
  concatenateAudio,
  createTranscriptionService,
  normalizeInferenceDevice
} = require("./transcription-service.cjs");

async function checkIdleUnload() {
  const events = [];
  const timers = [];
  const fake = async () => ({ text: "ok" });
  fake.dispose = async () => { events.push("disposed"); };
  const service = createTranscriptionService({
    userDataPath: "C:\models",
    resolveProfile: (id) => ({ id: id || "fast", model: "m", dtype: "q8", generation: {} }),
    ensureModelCache: async () => "C:\models",
    loadModelWithRetry: async (load) => ({ value: await load(), attempts: 1 }),
    importTransformers: async () => ({ env: {}, pipeline: async () => fake }),
    logger: { warn() {}, error() {} },
    idleUnloadMs: 5000,
    setTimer: (fn, ms) => { const timer = { fn, ms, cleared: false }; timers.push(timer); return timer; },
    clearTimer: (timer) => { timer.cleared = true; }
  });
  const live = () => timers.filter((timer) => !timer.cleared);

  const first = service.start({ profileId: "fast" });
  service.pushAudio(first.id, new Float32Array([0.1]));
  await service.finish(first.id);
  assert.equal(live().length, 1);
  assert.equal(live()[0].ms, 5000);

  const second = service.start({ profileId: "fast" });
  assert.equal(live().length, 0, "starting a session cancels the idle timer");
  service.pushAudio(second.id, new Float32Array([0.1]));
  await service.finish(second.id);
  assert.equal(live().length, 1);

  const pending = service.start({ profileId: "fast" });
  const stale = timers.at(-2);
  await stale.fn();
  assert.equal(events.length, 0, "never unloads while a session is active");
  service.cancel(pending.id);

  assert.equal(live().length, 1);
  const due = live()[0];
  due.cleared = true;
  await due.fn();
  assert.deepEqual(events, ["disposed"]);
  assert.equal(service.health().ready, false);

  await service.dispose();
  assert.equal(live().length, 0, "dispose clears the idle timer");
}

async function run() {
  assert.equal(normalizeInferenceDevice("dml", "win32"), "dml");
  assert.equal(normalizeInferenceDevice("dml", "darwin"), "cpu");
  assert.deepEqual([...concatenateAudio([new Float32Array([1, 2]), new Float32Array([3])])], [1, 2, 3]);

  const calls = [];
  const fakeTranscriber = async (samples, options) => {
    calls.push({ samples: [...samples], options });
    return { text: " hola " };
  };
  fakeTranscriber.dispose = async () => { calls.push({ disposed: true }); };
  const service = createTranscriptionService({
    userDataPath: "C:\\models",
    resolveProfile: (id) => ({
      id: id || "fast",
      model: "local/model",
      dtype: "q8",
      generation: { num_beams: 1 }
    }),
    ensureModelCache: async () => "C:\\models",
    loadModelWithRetry: async (load) => ({ value: await load(), attempts: 1 }),
    importTransformers: async () => ({
      env: {},
      pipeline: async (_task, _model, options) => {
        options.progress_callback({ status: "ready" });
        return fakeTranscriber;
      }
    }),
    logger: { warn() {}, error() {} }
  });

  const session = service.start({ language: "spanish", profileId: "fast", device: "cpu", sampleRate: 16000 });
  assert.equal(session.engine, "transformers-js");
  assert.equal(service.pushAudio(session.id, new Float32Array([0.1, 0.2])), true);
  assert.equal(service.pushAudio(session.id, new Float32Array([0.3])), true);
  const result = await service.finish(session.id);
  assert.equal(result.text, "hola");
  assert.deepEqual(calls[0].samples.map((value) => Number(value.toFixed(1))), [0.1, 0.2, 0.3]);
  assert.equal(result.metrics.engine, "transformers-js");
  assert.equal(service.health().ready, true);

  const resampled = service.start({ language: "spanish", profileId: "fast", sampleRate: 8000 });
  service.pushAudio(resampled.id, new Float32Array(800));
  await service.finish(resampled.id);
  assert.equal(calls.at(-1).samples.length, 1600);

  const cancelled = service.start({ profileId: "fast" });
  assert.equal(service.cancel(cancelled.id), true);
  await assert.rejects(() => service.finish(cancelled.id), /not active/);
  await service.dispose();
  assert.equal(calls.at(-1).disposed, true);

  await checkIdleUnload();

  console.log("Transcription service: 22 checks passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
