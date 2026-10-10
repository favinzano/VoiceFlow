const assert = require("node:assert/strict");
const { evaluateSpeechGate } = require("./speech-gate.cjs");
const { SAMPLE_MS, AMBIENT_JITTER, PROFILES, createRandom, between, wholeBetween, buildUtterance } = require("./corpus-builders.cjs");

// Synthetic corpus for the no-speech gate at the real 40 ms cadence, with a fixed seed.
const RECORDINGS_PER_CASE = 2000;
const SEED = 20261010;
const MIN_RATE = 0.99;

const historyOf = (levels) => ({ levels, times: levels.map((_, index) => index * SAMPLE_MS) });
const passes = (levels) => evaluateSpeechGate(historyOf(levels)).hasSpeech;

function rate(buildLevels, expected) {
  const random = createRandom(SEED);
  let correct = 0;
  for (let recording = 0; recording < RECORDINGS_PER_CASE; recording += 1) {
    if (passes(buildLevels(random)) === expected) correct += 1;
  }
  return correct / RECORDINGS_PER_CASE;
}

function ambientOnly(profile, random, samples) {
  const base = between(random, ...profile.ambientLevel);
  return Array.from({ length: samples }, () => base * between(random, ...AMBIENT_JITTER));
}

// Noise with `peaks` isolated peaks of 1-3 samples (40-120 ms), at least one quiet sample apart.
function noiseWithPeaks(profile, random, peaks) {
  const base = between(random, ...profile.ambientLevel);
  const noise = () => base * between(random, ...AMBIENT_JITTER);
  const levels = Array.from({ length: wholeBetween(random, 10, 25) }, noise);
  for (let peak = 0; peak < peaks; peak += 1) {
    for (let index = wholeBetween(random, 1, 3); index > 0; index -= 1) levels.push(between(random, 0.02, 0.3));
    for (let index = wholeBetween(random, 2, 20); index > 0; index -= 1) levels.push(noise());
  }
  return levels;
}

const report = [];
function check(name, actualRate, minimum) {
  report.push(`${name}: ${(actualRate * 100).toFixed(2)}%`);
  assert.ok(actualRate >= minimum, `${name}: ${(actualRate * 100).toFixed(2)}% is below ${minimum * 100}%`);
}

// Normal dictations, with pauses, in every room: never lost.
for (const [name, profile] of Object.entries(PROFILES)) {
  check(`speech ${name} passes`, rate((random) => buildUtterance(profile, random).levels, true), 1);
}

// Quiet speakers over steady background noise still pass.
const noisyDesk = { ...PROFILES.referenceRoom, ambientLevel: [0.003, 0.004] };
check(
  "quiet voice over noise passes",
  rate((random) => buildUtterance(noisyDesk, random, { speakerLevel: [0.012, 0.02] }).levels, true),
  MIN_RATE
);

// Noise alone, with or without the occasional short spike, is discarded.
for (const [name, profile] of Object.entries(PROFILES)) {
  check(`noise only ${name} is discarded`, rate((random) => ambientOnly(profile, random, wholeBetween(random, 25, 200)), false), MIN_RATE);
}

// Many isolated peaks never add up to speech.
for (const peaks of [8, 15, 30]) {
  check(`${peaks} isolated peaks are discarded`, rate((random) => noiseWithPeaks(PROFILES.referenceRoom, random, peaks), false), MIN_RATE);
}

console.log(`Speech gate corpus: ${report.join(" | ")}`);
