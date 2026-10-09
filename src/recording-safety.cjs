"use strict";

const MAX_RECORDING_MS = 10 * 60 * 1000;

const INTERRUPT_REASON = Object.freeze({
  MICROPHONE_LOST: "microphone-lost",
  TIME_LIMIT: "time-limit",
  SYSTEM_SLEEP: "system-sleep",
  SCREEN_LOCKED: "screen-locked"
});

const MESSAGES = Object.freeze({
  [INTERRUPT_REASON.MICROPHONE_LOST]: "El micrófono se desconectó. Procesando lo grabado.",
  [INTERRUPT_REASON.TIME_LIMIT]: "Se alcanzó el límite de 10 minutos. Procesando lo grabado.",
  [INTERRUPT_REASON.SYSTEM_SLEEP]: "El equipo entró en suspensión. Procesando lo grabado.",
  [INTERRUPT_REASON.SCREEN_LOCKED]: "La pantalla se bloqueó. Procesando lo grabado."
});

function isRecordingTooLong(elapsedMs, maxMs = MAX_RECORDING_MS) {
  return Number.isFinite(elapsedMs) && elapsedMs >= maxMs;
}

function interruptMessage(reason) {
  return MESSAGES[reason] || "La grabación se interrumpió. Procesando lo grabado.";
}

// Avisa una sola vez cuando cualquier pista de audio termina por sí sola (micrófono
// desconectado o retirado por el sistema). El evento "ended" no se emite cuando la propia
// app llama a track.stop(), así que no interfiere con el cierre normal.
function watchTrackEnded(stream, onEnded) {
  const tracks = typeof stream?.getAudioTracks === "function" ? stream.getAudioTracks() : [];
  let notified = false;
  const listener = () => {
    if (notified) return;
    notified = true;
    onEnded();
  };
  for (const track of tracks) track.addEventListener("ended", listener);
  return () => {
    for (const track of tracks) track.removeEventListener("ended", listener);
  };
}

module.exports = {
  INTERRUPT_REASON,
  MAX_RECORDING_MS,
  interruptMessage,
  isRecordingTooLong,
  watchTrackEnded
};
