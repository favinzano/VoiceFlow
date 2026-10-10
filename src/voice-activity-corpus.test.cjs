const assert = require("node:assert/strict");
const { createVoiceActivityDetector } = require("./voice-activity.cjs");

// Synthetic corpus of dictations with pauses. Levels arrive every 40 ms, the real worklet cadence.
// A "premature cut" is an auto-stop that fires while the speaker still has words left to say.
const SAMPLE_MS = 40;
const UTTERANCES_PER_PROFILE = 2000;
const DEFAULT_SILENCE_TIMEOUT_MS = 1800;
const TRAILING_SILENCE_SAMPLES = 100;
const MAX_PREMATURE_CUT_RATE = 0.01;
const MIN_CLEAN_STOP_RATE = 0.99;

function createRandom(seed) {
  let state = seed;
  return () => {
    state = (1103515245 * state + 12345) % 2147483648;
    return state / 2147483648;
  };
}

const between = (random, min, max) => min + random() * (max - min);
const wholeBetween = (random, min, max) => Math.floor(between(random, min, max + 1));

// Steady room noise keeps a stable level per dictation with small window-to-window variation.
const AMBIENT_JITTER = [0.8, 1.2];

const PROFILES = {
  quietRoom: { ambientLevel: [0.0003, 0.0008], pauseSpikeChance: 0, leadInSamples: [15, 40] },
  // Matches the measurement on the reference machine: p50 0.0037, max 0.0050.
  referenceRoom: { ambientLevel: [0.0035, 0.0042], pauseSpikeChance: 0.05, leadInSamples: [25, 50] },
  noisyRoom: { ambientLevel: [0.002, 0.0065], pauseSpikeChance: 0.15, leadInSamples: [25, 50] }
};

// Pauses between words, in samples: mostly short gaps, some thinking pauses, a rare long one (<= 1.7 s).
function pauseSamples(random) {
  const kind = random();
  if (kind < 0.85) return wholeBetween(random, 4, 15); // 0.16-0.60 s
  if (kind < 0.99) return wholeBetween(random, 15, 30); // 0.60-1.20 s
  return wholeBetween(random, 30, 42); // 1.20-1.68 s
}

function buildUtterance(profile, random) {
  const levels = [];
  const ambientBase = between(random, ...profile.ambientLevel);
  const ambient = () => ambientBase * between(random, ...AMBIENT_JITTER);
  const leadIn = wholeBetween(random, ...profile.leadInSamples);
  for (let index = 0; index < leadIn; index += 1) levels.push(ambient());

  const speakerLevel = 0.012 * Math.pow(10, random()); // 0.012-0.12 RMS
  const words = wholeBetween(random, 3, 12);
  let lastVoicedIndex = -1;
  for (let word = 0; word < words; word += 1) {
    const length = wholeBetween(random, 5, 20);
    for (let index = 0; index < length; index += 1) {
      const closure = random() < 0.1; // consonant closure: a 40 ms dip inside a word
      levels.push(closure ? 0.003 : speakerLevel * between(random, 0.5, 1.5));
    }
    lastVoicedIndex = levels.length - 1;
    if (word === words - 1) break;
    const pause = pauseSamples(random);
    const spikeAt = random() < profile.pauseSpikeChance ? wholeBetween(random, 0, Math.max(0, pause - 3)) : -1;
    for (let index = 0; index < pause; index += 1) {
      const inSpike = spikeAt >= 0 && index >= spikeAt && index < spikeAt + wholeBetween(random, 1, 3);
      levels.push(inSpike ? between(random, 0.006, 0.03) : ambient());
    }
  }
  for (let index = 0; index < TRAILING_SILENCE_SAMPLES; index += 1) levels.push(ambient());
  return { levels, lastVoicedIndex };
}

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
