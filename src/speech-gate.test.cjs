const assert = require("node:assert/strict");
const { evaluateSpeechGate, DEFAULT_MINIMUM_SPEECH_MS } = require("./speech-gate.cjs");
const { createVoiceActivityDetector } = require("./voice-activity.cjs");

assert.equal(DEFAULT_MINIMUM_SPEECH_MS, 300);

assert.deepEqual(evaluateSpeechGate({ speechDetected: false, speechMs: 0 }), { hasSpeech: false, speechMs: 0 });
assert.deepEqual(evaluateSpeechGate({ speechDetected: true, speechMs: 100 }), { hasSpeech: false, speechMs: 100 }, "click");
assert.deepEqual(evaluateSpeechGate({ speechDetected: true, speechMs: 200 }), { hasSpeech: false, speechMs: 200 });
assert.equal(evaluateSpeechGate({ speechDetected: true, speechMs: 299 }).hasSpeech, false);
assert.equal(evaluateSpeechGate({ speechDetected: true, speechMs: 300 }).hasSpeech, true, "threshold is inclusive");
assert.deepEqual(evaluateSpeechGate({ speechDetected: true, speechMs: 400 }), { hasSpeech: true, speechMs: 400 });
assert.equal(evaluateSpeechGate({ speechDetected: false, speechMs: 500 }).hasSpeech, false, "both signals must agree");

assert.equal(evaluateSpeechGate({ speechDetected: true, speechMs: 150 }, { minimumSpeechMs: 100 }).hasSpeech, true);
assert.equal(evaluateSpeechGate({ speechDetected: true, speechMs: 400 }, { minimumSpeechMs: 500 }).hasSpeech, false);
for (const invalid of [-1, Number.NaN, Infinity, "300", null]) {
  assert.equal(
    evaluateSpeechGate({ speechDetected: true, speechMs: 250 }, { minimumSpeechMs: invalid }).hasSpeech,
    false,
    `invalid minimum ${String(invalid)} falls back to the default`
  );
}

// Without a usable summary the gate fails open: transcribing once too often beats losing a dictation.
for (const missing of [undefined, null, {}, { speechDetected: true }, { speechDetected: true, speechMs: Number.NaN }, "speech", 42]) {
  assert.deepEqual(evaluateSpeechGate(missing), { hasSpeech: true, speechMs: 0 }, `missing summary ${JSON.stringify(missing)}`);
}

const frozen = Object.freeze({ speechDetected: true, speechMs: 400 });
assert.doesNotThrow(() => evaluateSpeechGate(frozen), "input is never mutated");

// End to end with the real detector: silence, a click, a short word and a real phrase.
function summaryFor(levels, intervalMs = 100) {
  const detector = createVoiceActivityDetector({ silenceTimeoutMs: 100000 });
  levels.forEach((rms, index) => detector.update(rms, index * intervalMs));
  return detector.getSummary();
}
const quiet = (count) => Array.from({ length: count }, () => 0.001);
const voiced = (count) => Array.from({ length: count }, () => 0.03);

assert.equal(evaluateSpeechGate(summaryFor(quiet(30))).hasSpeech, false, "silence");
assert.equal(evaluateSpeechGate(summaryFor([...quiet(10), 0.2, ...quiet(10)])).hasSpeech, false, "click");
assert.equal(evaluateSpeechGate(summaryFor([...quiet(10), ...voiced(2), ...quiet(10)])).hasSpeech, false, "200 ms of voice");
assert.equal(evaluateSpeechGate(summaryFor([...quiet(10), ...voiced(4), ...quiet(10)])).hasSpeech, true, "400 ms of voice");
assert.equal(evaluateSpeechGate(summaryFor([...voiced(5), ...quiet(5), ...voiced(8)], 50)).hasSpeech, true, "voice in 50 ms steps");

console.log("Speech gate: all checks passed.");
