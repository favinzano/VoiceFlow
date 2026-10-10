const assert = require("node:assert/strict");
const { createVoiceActivityDetector } = require("./voice-activity.cjs");
const { SAMPLE_MS, AMBIENT_JITTER, PROFILES, createRandom, between, buildUtterance } = require("./corpus-builders.cjs");

// Synthetic corpus of dictations with pauses (builders in corpus-builders.cjs).
// A "premature cut" is an auto-stop that fires while the speaker still has words left to say.
const UTTERANCES_PER_PROFILE = 2000;
const DEFAULT_SILENCE_TIMEOUT_MS = 1800;
const MAX_PREMATURE_CUT_RATE = 0.01;
const MIN_CLEAN_STOP_RATE = 0.99;

function runCorpus(profile, silenceTimeoutMs, seed) {
  const random = createRandom(seed);
  const totals = { utterances: 0, prematureCuts: 0, cleanStops: 0, missedStops: 0 };
  for (let utterance = 0; utterance < UTTERANCES_PER_PROFILE; utterance += 1) {
    const { levels, lastVoicedIndex } = buildUtterance(profile, random);
    const detector = createVoiceActivityDetector({ silenceTimeoutMs });
    let stoppedAt = -1;
    for (let index = 0; index < levels.length && stoppedAt < 0; index += 1) {
      if (detector.update(levels[index], index * SAMPLE_MS)) stoppedAt = index;
    }
    totals.utterances += 1;
    if (stoppedAt < 0) totals.missedStops += 1;
    else if (stoppedAt < lastVoicedIndex) totals.prematureCuts += 1;
    else if ((stoppedAt - lastVoicedIndex) * SAMPLE_MS <= silenceTimeoutMs + 200) totals.cleanStops += 1;
  }
  return totals;
}

const report = [];
for (const [name, profile] of Object.entries(PROFILES)) {
  const totals = runCorpus(profile, DEFAULT_SILENCE_TIMEOUT_MS, 20261009);
  report.push(`${name}: cuts ${totals.prematureCuts}, clean stops ${totals.cleanStops}, no stop ${totals.missedStops} of ${totals.utterances}`);
  assert.ok(
    totals.prematureCuts / totals.utterances < MAX_PREMATURE_CUT_RATE,
    `${name}: ${totals.prematureCuts}/${totals.utterances} premature auto-stops at ${DEFAULT_SILENCE_TIMEOUT_MS} ms`
  );
  assert.ok(
    totals.cleanStops / totals.utterances >= MIN_CLEAN_STOP_RATE,
    `${name}: only ${totals.cleanStops}/${totals.utterances} dictations auto-stopped right after the last word`
  );
}
console.log(`Voice activity corpus (${DEFAULT_SILENCE_TIMEOUT_MS} ms grace): ${report.join(" | ")}`);

// The corpus must be able to see premature cuts: the 1.2 s setting does cut the rare 1.2-1.7 s pauses.
const shortGrace = runCorpus(PROFILES.referenceRoom, 1200, 20261009);
assert.ok(shortGrace.prematureCuts > 0, "a 1.2 s grace period should cut some long pauses, otherwise the corpus is vacuous");
console.log(`Voice activity corpus (1200 ms grace, informational): ${shortGrace.prematureCuts} cuts of ${shortGrace.utterances}`);

// Negative cases: nothing but room noise, or a single click, never counts as a dictation.
for (const [name, profile] of Object.entries(PROFILES)) {
  const random = createRandom(7);
  const ambientBase = between(random, ...profile.ambientLevel);
  const noise = Array.from({ length: 200 }, () => ambientBase * between(random, ...AMBIENT_JITTER));
  const roomOnly = createVoiceActivityDetector();
  const stopped = noise.some((rms, index) => roomOnly.update(rms, index * SAMPLE_MS));
  assert.equal(stopped, false, `${name}: room noise alone never auto-stops`);
  assert.deepEqual(roomOnly.getSummary(), { speechDetected: false, speechMs: 0 }, `${name}: room noise is not speech`);

  const click = createVoiceActivityDetector();
  noise.slice(0, 20).forEach((rms, index) => click.update(rms, index * SAMPLE_MS));
  click.update(0.2, 20 * SAMPLE_MS);
  noise.slice(21, 60).forEach((rms, index) => click.update(rms, (21 + index) * SAMPLE_MS));
  assert.ok(click.getSummary().speechMs <= SAMPLE_MS, `${name}: a click counts at most one sample of speech`);
}
console.log("Voice activity corpus: silence, room noise and click are never speech.");
