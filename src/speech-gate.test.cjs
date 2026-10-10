const assert = require("node:assert/strict");
const { evaluateSpeechGate, DEFAULT_MINIMUM_SPEECH_MS, DEFAULT_MINIMUM_RUN_MS } = require("./speech-gate.cjs");
const { createVoiceActivityDetector } = require("./voice-activity.cjs");

assert.equal(DEFAULT_MINIMUM_SPEECH_MS, 300);
assert.equal(DEFAULT_MINIMUM_RUN_MS, 160);

const history = (levels, intervalMs = 40) => ({ levels, times: levels.map((_, index) => index * intervalMs) });
const constant = (count, level) => Array.from({ length: count }, () => level);
const decide = (levels, intervalMs, options) => evaluateSpeechGate(history(levels, intervalMs), options);

// Basic cases at the real 40 ms cadence.
assert.equal(decide(constant(40, 0.001)).hasSpeech, false, "silence");
assert.equal(decide([...constant(20, 0.001), 0.2, ...constant(20, 0.001)]).hasSpeech, false, "click");
assert.equal(decide([...constant(20, 0.001), ...constant(3, 0.03), ...constant(20, 0.001)]).hasSpeech, false, "120 ms of voice");
assert.equal(decide([...constant(20, 0.001), ...constant(7, 0.03), ...constant(20, 0.001)]).hasSpeech, false, "280 ms of voice");
const phrase = decide([...constant(20, 0.001), ...constant(8, 0.03), ...constant(20, 0.001)]);
assert.deepEqual(phrase, { hasSpeech: true, speechMs: 320 }, "320 ms of voice");

// Isolated peaks never add up, however many there are.
for (const peaks of [8, 15, 30]) {
  const levels = [];
  for (let index = 0; index < peaks; index += 1) levels.push(...constant(4, 0.001), 0.05);
  levels.push(...constant(10, 0.001));
  assert.equal(decide(levels).hasSpeech, false, `${peaks} isolated peaks`);
}

// Runs shorter than the minimum are dropped, runs of the minimum count.
const shortRuns = [];
for (let index = 0; index < 6; index += 1) shortRuns.push(...constant(3, 0.03), ...constant(5, 0.001));
assert.equal(decide(shortRuns).hasSpeech, false, "six 120 ms runs");
const twoRuns = [...constant(10, 0.001), ...constant(4, 0.03), ...constant(5, 0.001), ...constant(4, 0.03), ...constant(10, 0.001)];
assert.deepEqual(decide(twoRuns), { hasSpeech: true, speechMs: 320 }, "two 160 ms runs");

// Low voice over steady background noise passes; the noise alone does not.
const noise = constant(25, 0.004);
assert.equal(decide([...noise, ...constant(10, 0.010), ...noise]).hasSpeech, true, "0.010 voice over 0.004 noise");
assert.equal(decide([...noise, ...noise, ...noise]).hasSpeech, false, "0.004 noise only");
assert.equal(decide(constant(60, 0.0075)).hasSpeech, false, "steady noise just under the ceiling");

// Uniform voice with no quiet stretch behaves like the absolute threshold.
assert.equal(decide(constant(40, 0.03)).hasSpeech, true, "voice from the first sample");

// The cadence is read from the timestamps, not assumed.
assert.equal(decide([...constant(10, 0.001), ...constant(4, 0.03), ...constant(10, 0.001)], 100).hasSpeech, true, "400 ms at 100 ms steps");
assert.equal(decide([...constant(10, 0.001), ...constant(2, 0.03), ...constant(10, 0.001)], 100).hasSpeech, false, "200 ms at 100 ms steps");
assert.equal(decide([...constant(20, 0.001), ...constant(8, 0.03), ...constant(20, 0.001)], 50).hasSpeech, true, "400 ms at 50 ms steps");
const jittery = history([...constant(20, 0.001), ...constant(8, 0.03), ...constant(20, 0.001)]);
jittery.times = jittery.times.map((time, index) => time + (index % 2) * 3);
assert.equal(evaluateSpeechGate(jittery).hasSpeech, true, "timestamp jitter");

// Options.
assert.equal(decide(twoRuns, 40, { minimumSpeechMs: 400 }).hasSpeech, false);
assert.equal(decide(twoRuns, 40, { minimumRunMs: 200 }).hasSpeech, false);
for (const invalid of [-1, Number.NaN, Infinity, "300", null]) {
  assert.equal(decide(twoRuns, 40, { minimumSpeechMs: invalid }).hasSpeech, true, `invalid minimum ${String(invalid)} falls back`);
  assert.equal(decide(shortRuns, 40, { minimumRunMs: invalid }).hasSpeech, false, `invalid run ${String(invalid)} falls back`);
}

// Without a usable history the gate fails open.
const open = { hasSpeech: true, speechMs: 0 };
for (const missing of [
  undefined,
  null,
  {},
  "speech",
  42,
  { levels: [0.1], times: [] },
  { levels: [0.001, Number.NaN, 0.001, 0.001, 0.001, 0.001], times: [0, 40, 80, 120, 160, 200] },
  { levels: [0.001, 0.001, 0.001, 0.001, 0.001, 0.001], times: [0, 40, "80", 120, 160, 200] },
  { levels: "0.001", times: "0" },
  history([]),
  history([0.001, 0.001, 0.001])
]) {
  assert.deepEqual(evaluateSpeechGate(missing), open, `unusable history ${JSON.stringify(missing)}`);
}

// Recordings shorter than one 200 ms noise window (5 samples at 40 ms) always reach the engine.
assert.deepEqual(evaluateSpeechGate(history(constant(4, 0.001))), open, "4 samples fail open");
assert.equal(evaluateSpeechGate(history(constant(5, 0.001))).hasSpeech, false, "5 samples are decided");

// Constant noise above the ceiling cannot be told from speech: it passes, as before the gate existed.
assert.equal(decide(constant(60, 0.02)).hasSpeech, true, "loud steady noise passes");

// Identical timestamps fall back to the nominal cadence instead of failing.
const sameTime = { levels: constant(40, 0.001), times: constant(40, 5) };
assert.equal(evaluateSpeechGate(sameTime).hasSpeech, false);

// Inputs are never mutated.
const frozen = Object.freeze({ levels: Object.freeze(constant(30, 0.03)), times: Object.freeze(constant(30, 0).map((_, i) => i * 40)) });
assert.doesNotThrow(() => evaluateSpeechGate(frozen));
assert.doesNotThrow(() => evaluateSpeechGate(history(constant(30, 0.03)), Object.freeze({ minimumSpeechMs: 300 })));

// End to end with the real detector's history.
function historyFor(levels, intervalMs = 40) {
  const detector = createVoiceActivityDetector({ silenceTimeoutMs: 100000 });
  levels.forEach((rms, index) => detector.update(rms, index * intervalMs));
  return detector.getLevels();
}
assert.equal(evaluateSpeechGate(historyFor(constant(40, 0.001))).hasSpeech, false, "detector: silence");
assert.equal(evaluateSpeechGate(historyFor([...constant(20, 0.001), 0.2, ...constant(20, 0.001)])).hasSpeech, false, "detector: click");
assert.equal(evaluateSpeechGate(historyFor([...constant(20, 0.001), ...constant(10, 0.03), ...constant(20, 0.001)])).hasSpeech, true, "detector: phrase");

console.log("Speech gate: all checks passed.");
