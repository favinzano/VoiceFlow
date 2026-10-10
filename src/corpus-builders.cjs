// Shared builders for the synthetic test corpora. Levels arrive every 40 ms, the real worklet cadence.
const SAMPLE_MS = 40;
const TRAILING_SILENCE_SAMPLES = 100;

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

// `speakerLevel` overrides the default 0.012-0.12 RMS range, e.g. to model a quiet speaker.
function buildUtterance(profile, random, { speakerLevel } = {}) {
  const levels = [];
  const ambientBase = between(random, ...profile.ambientLevel);
  const ambient = () => ambientBase * between(random, ...AMBIENT_JITTER);
  const leadIn = wholeBetween(random, ...profile.leadInSamples);
  for (let index = 0; index < leadIn; index += 1) levels.push(ambient());

  const voiceLevel = speakerLevel ? between(random, ...speakerLevel) : 0.012 * Math.pow(10, random());
  const words = wholeBetween(random, 3, 12);
  let lastVoicedIndex = -1;
  for (let word = 0; word < words; word += 1) {
    const length = wholeBetween(random, 5, 20);
    for (let index = 0; index < length; index += 1) {
      const closure = random() < 0.1; // consonant closure: a 40 ms dip inside a word
      levels.push(closure ? 0.003 : voiceLevel * between(random, 0.5, 1.5));
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

module.exports = {
  SAMPLE_MS,
  AMBIENT_JITTER,
  PROFILES,
  createRandom,
  between,
  wholeBetween,
  buildUtterance
};
