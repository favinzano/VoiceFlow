const assert = require("node:assert/strict");
const { createVoiceActivityDetector } = require("./voice-activity.cjs");

const initialSilence = createVoiceActivityDetector({ silenceTimeoutMs: 1000 });
assert.equal(initialSilence.update(0, 0), false);
assert.equal(initialSilence.update(0, 5000), false);

const pause = createVoiceActivityDetector({ silenceTimeoutMs: 1000 });
assert.equal(pause.update(0.02, 0), false);
assert.equal(pause.update(0.001, 100), false);
assert.equal(pause.update(0.001, 1099), false);
assert.equal(pause.update(0.001, 1100), true);
assert.equal(pause.update(0.02, 1200), false);

const resumedSpeech = createVoiceActivityDetector({ silenceTimeoutMs: 1000 });
resumedSpeech.update(0.02, 0);
resumedSpeech.update(0.001, 100);
assert.equal(resumedSpeech.update(0.02, 900), false);
assert.equal(resumedSpeech.update(0.001, 1000), false);
assert.equal(resumedSpeech.update(0.001, 2000), true);

const noisyRoom = createVoiceActivityDetector({ silenceTimeoutMs: 500 });
for (let index = 0; index < 20; index += 1) assert.equal(noisyRoom.update(0.006, index * 100), false);
assert.equal(noisyRoom.update(0.03, 2100), false);
assert.equal(noisyRoom.update(0.003, 2200), false);
assert.equal(noisyRoom.update(0.003, 2700), true);

const noiseBlip = createVoiceActivityDetector({ silenceTimeoutMs: 1000 });
noiseBlip.update(0.02, 0);
assert.equal(noiseBlip.update(0.001, 100), false);
assert.equal(noiseBlip.update(0.005, 600), false);
assert.equal(noiseBlip.update(0.001, 700), false);
assert.equal(noiseBlip.update(0.001, 1099), false);
assert.equal(noiseBlip.update(0.001, 1700), true);

const emptySummary = createVoiceActivityDetector().getSummary();
assert.deepEqual(emptySummary, { speechDetected: false, speechMs: 0 });

for (const cadenceMs of [50, 100, 200]) {
  const spoken = createVoiceActivityDetector({ silenceTimeoutMs: 100000 });
  for (let at = 0; at < 1000; at += cadenceMs) spoken.update(0.02, at);
  const summary = spoken.getSummary();
  assert.equal(summary.speechDetected, true);
  assert.equal(summary.speechMs, 100 + (Math.ceil(1000 / cadenceMs) - 1) * cadenceMs, `cadence ${cadenceMs}`);
}

const quietRoom = createVoiceActivityDetector();
for (let at = 0; at < 3000; at += 100) quietRoom.update(0.001, at);
assert.deepEqual(quietRoom.getSummary(), { speechDetected: false, speechMs: 0 });

const stalledSampler = createVoiceActivityDetector({ silenceTimeoutMs: 100000 });
stalledSampler.update(0.02, 0);
stalledSampler.update(0.02, 10000);
assert.equal(stalledSampler.getSummary().speechMs, 100 + 250, "a long gap between samples is capped");

const pausedSpeech = createVoiceActivityDetector({ silenceTimeoutMs: 100000 });
pausedSpeech.update(0.02, 0);
pausedSpeech.update(0.001, 100);
pausedSpeech.update(0.001, 200);
pausedSpeech.update(0.02, 300);
assert.equal(pausedSpeech.getSummary().speechMs, 100 + 100, "silence does not add speech time");

const summaryIsASnapshot = createVoiceActivityDetector();
const firstSummary = summaryIsASnapshot.getSummary();
summaryIsASnapshot.update(0.02, 0);
assert.equal(firstSummary.speechMs, 0, "an earlier summary is not mutated by later updates");

const autoStopped = createVoiceActivityDetector({ silenceTimeoutMs: 500 });
autoStopped.update(0.02, 0);
autoStopped.update(0.001, 100);
assert.equal(autoStopped.update(0.001, 700), true);
assert.deepEqual(autoStopped.getSummary(), { speechDetected: true, speechMs: 100 });

// With auto-stop off the recording goes on after the detector reached its stop point: later speech still counts.
const speechAfterStop = createVoiceActivityDetector({ silenceTimeoutMs: 500 });
speechAfterStop.update(0.02, 0);
speechAfterStop.update(0.001, 100);
assert.equal(speechAfterStop.update(0.001, 700), true);
assert.equal(speechAfterStop.update(0.03, 740), false, "a stopped detector never asks to stop again");
assert.equal(speechAfterStop.update(0.03, 780), false);
assert.deepEqual(speechAfterStop.getSummary(), { speechDetected: true, speechMs: 100 + 40 + 40 });

const emptyHistory = createVoiceActivityDetector();
assert.deepEqual(emptyHistory.getLevels(), { levels: [], times: [] });

const history = createVoiceActivityDetector({ silenceTimeoutMs: 500 });
const expectedLevels = [0.02, 0.001, 0.001, 0.03, 0.002];
const expectedTimes = [0, 100, 700, 740, 780];
expectedLevels.forEach((level, index) => history.update(level, expectedTimes[index]));
assert.deepEqual(
  history.getLevels(),
  { levels: expectedLevels, times: expectedTimes },
  "one pair per update call, including those after the stop point"
);

const historyCopy = history.getLevels();
historyCopy.levels.push(1);
historyCopy.times.push(1);
historyCopy.levels[0] = 99;
assert.deepEqual(history.getLevels().levels, expectedLevels, "mutating a returned history does not alter the detector");
assert.deepEqual(history.getLevels().times, expectedTimes);
assert.deepEqual(history.getSummary(), { speechDetected: true, speechMs: 100 + 40 }, "history does not change the summary");

const corruptSamples = createVoiceActivityDetector();
corruptSamples.update(0.001, 0);
corruptSamples.update(Number.NaN, 40);
corruptSamples.update(0.002, Number.NaN);
corruptSamples.update(Infinity, 80);
corruptSamples.update(0.003, 120);
assert.deepEqual(corruptSamples.getLevels(), { levels: [0.001, 0.003], times: [0, 120] }, "non-finite samples stay out of the history");

console.log("Voice activity: all checks passed.");
