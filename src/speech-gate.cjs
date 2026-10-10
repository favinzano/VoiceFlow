const DEFAULT_MINIMUM_SPEECH_MS = 300;
const DEFAULT_MINIMUM_RUN_MS = 160;
const NOISE_WINDOW_MS = 200;
const FALLBACK_INTERVAL_MS = 100;
const NOISE_FLOOR_FACTOR = 2;
// The ceiling keeps the gate no stricter in level than the detector's absolute speech threshold.
const MIN_THRESHOLD = 0.005;
const MAX_THRESHOLD = 0.008;

function isUsableHistory(history) {
  if (typeof history !== "object" || history === null) return false;
  const { levels, times } = history;
  return (
    Array.isArray(levels) &&
    Array.isArray(times) &&
    levels.length === times.length &&
    levels.every(Number.isFinite) &&
    times.every(Number.isFinite)
  );
}

function resolveNonNegativeMs(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function medianIntervalMs(times) {
  const gaps = [];
  for (let index = 1; index < times.length; index += 1) {
    const gap = times[index] - times[index - 1];
    if (gap > 0) gaps.push(gap);
  }
  if (gaps.length === 0) return FALLBACK_INTERVAL_MS;
  gaps.sort((a, b) => a - b);
  const middle = Math.floor(gaps.length / 2);
  return gaps.length % 2 === 1 ? gaps[middle] : (gaps[middle - 1] + gaps[middle]) / 2;
}

// Lowest mean level over any window of `windowSize` consecutive samples.
function lowestWindowMean(levels, windowSize) {
  let sum = 0;
  let lowest = Infinity;
  for (let index = 0; index < levels.length; index += 1) {
    sum += levels[index];
    if (index >= windowSize) sum -= levels[index - windowSize];
    if (index >= windowSize - 1) lowest = Math.min(lowest, sum / windowSize);
  }
  return lowest;
}

// Total duration of runs of consecutive samples at or above the threshold that last long enough.
function speechRunsMs(levels, threshold, intervalMs, minimumRunMs) {
  let total = 0;
  let runLength = 0;
  const closeRun = () => {
    const duration = runLength * intervalMs;
    if (duration >= minimumRunMs) total += duration;
    runLength = 0;
  };
  for (const level of levels) {
    if (level >= threshold) runLength += 1;
    else closeRun();
  }
  closeRun();
  return total;
}

// Decides from a recording's level history whether it is worth sending to the engine.
// Speech is made of sustained runs above a threshold derived from the recording's own noise floor;
// isolated peaks (taps, clicks) never add up. Fails open: without a usable history the audio is
// transcribed, because transcribing once too often is cheaper than silently losing a dictation.
function evaluateSpeechGate(history, options = {}) {
  if (!isUsableHistory(history)) return { hasSpeech: true, speechMs: 0 };
  const { levels, times } = history;
  const intervalMs = medianIntervalMs(times);
  const windowSize = Math.max(1, Math.round(NOISE_WINDOW_MS / intervalMs));
  if (levels.length < windowSize) return { hasSpeech: true, speechMs: 0 };

  const noiseFloor = lowestWindowMean(levels, windowSize);
  const threshold = Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, NOISE_FLOOR_FACTOR * noiseFloor));
  const minimumRunMs = resolveNonNegativeMs(options.minimumRunMs, DEFAULT_MINIMUM_RUN_MS);
  const minimumSpeechMs = resolveNonNegativeMs(options.minimumSpeechMs, DEFAULT_MINIMUM_SPEECH_MS);
  const speechMs = speechRunsMs(levels, threshold, intervalMs, minimumRunMs);
  return { hasSpeech: speechMs >= minimumSpeechMs, speechMs };
}

module.exports = { evaluateSpeechGate, DEFAULT_MINIMUM_SPEECH_MS, DEFAULT_MINIMUM_RUN_MS };
