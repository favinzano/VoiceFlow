const DEFAULT_MINIMUM_SPEECH_MS = 300;

function isUsableSummary(summary) {
  return (
    typeof summary === "object" &&
    summary !== null &&
    typeof summary.speechDetected === "boolean" &&
    Number.isFinite(summary.speechMs)
  );
}

function resolveMinimumSpeechMs(value) {
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_MINIMUM_SPEECH_MS;
}

// Decides from a voice-activity summary whether a recording is worth sending to the engine.
// Fails open: without a usable summary the audio is transcribed, because transcribing once
// too often is cheaper than silently losing a dictation.
function evaluateSpeechGate(summary, options = {}) {
  if (!isUsableSummary(summary)) return { hasSpeech: true, speechMs: 0 };
  const minimumSpeechMs = resolveMinimumSpeechMs(options.minimumSpeechMs);
  return {
    hasSpeech: summary.speechDetected && summary.speechMs >= minimumSpeechMs,
    speechMs: summary.speechMs
  };
}

module.exports = { evaluateSpeechGate, DEFAULT_MINIMUM_SPEECH_MS };
