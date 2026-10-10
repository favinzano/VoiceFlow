const NOMINAL_SAMPLE_INTERVAL_MS = 100;
// A stalled sampler (e.g. a throttled worklet) must not count as continuous speech.
const MAX_SAMPLE_INTERVAL_MS = 250;

function createVoiceActivityDetector(options = {}) {
  const minimumSpeechThreshold = options.speechThreshold ?? 0.008;
  const minimumSilenceThreshold = options.silenceThreshold ?? 0.004;
  const silenceTimeoutMs = options.silenceTimeoutMs ?? 1800;
  let noiseFloor = options.initialNoiseFloor ?? 0.001;
  let speechDetected = false;
  let silenceStartedAt;
  let lastNoiseFloorUpdateAt;
  let stopped = false;
  let speechMs = 0;
  let lastUpdateAt;
  const levels = [];
  const times = [];

  return {
    getSummary() {
      return { speechDetected, speechMs };
    },
    getLevels() {
      return { levels: [...levels], times: [...times] };
    },
    update(rms, now = Date.now()) {
      // A corrupt sample must not poison the history the speech gate decides from.
      if (Number.isFinite(rms) && Number.isFinite(now)) {
        levels.push(rms);
        times.push(now);
      }
      const sampleIntervalMs = lastUpdateAt === undefined
        ? NOMINAL_SAMPLE_INTERVAL_MS
        : Math.min(MAX_SAMPLE_INTERVAL_MS, Math.max(0, now - lastUpdateAt));
      lastUpdateAt = now;
      const speechThreshold = Math.max(minimumSpeechThreshold, noiseFloor * 3);
      if (stopped) {
        // Recording may continue after the stop point (auto-stop off): keep the speech summary honest.
        if (rms >= speechThreshold) speechMs += sampleIntervalMs;
        return false;
      }
      const silenceThreshold = Math.max(minimumSilenceThreshold, noiseFloor * 1.8);
      if (rms >= speechThreshold) {
        speechDetected = true;
        speechMs += sampleIntervalMs;
        silenceStartedAt = undefined;
        return false;
      }
      if (!speechDetected) {
        // Scaled by elapsed time (not call count) so the noise-floor calibration
        // speed stays constant regardless of how often the caller samples rms
        // (e.g. the mic level worklet's update cadence).
        const elapsedMs = now - (lastNoiseFloorUpdateAt ?? now - 100);
        lastNoiseFloorUpdateAt = now;
        const alpha = 1 - Math.pow(0.9, elapsedMs / 100);
        noiseFloor = noiseFloor * (1 - alpha) + rms * alpha;
      }
      if (!speechDetected || rms > silenceThreshold) {
        silenceStartedAt = undefined;
        return false;
      }
      silenceStartedAt ??= now;
      if (now - silenceStartedAt < silenceTimeoutMs) return false;
      stopped = true;
      return true;
    }
  };
}

module.exports = { createVoiceActivityDetector };
