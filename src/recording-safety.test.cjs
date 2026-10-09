const assert = require("node:assert/strict");
const {
  MAX_RECORDING_MS,
  INTERRUPT_REASON,
  interruptMessage,
  isRecordingTooLong,
  watchTrackEnded
} = require("./recording-safety.cjs");

let checks = 0;
function check(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
  checks += 1;
}

function fakeTrack() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) || []), listener]);
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) || []).filter((item) => item !== listener));
    },
    emit(type) {
      for (const listener of [...(listeners.get(type) || [])]) listener();
    },
    count: (type) => (listeners.get(type) || []).length
  };
}

function fakeStream(tracks) {
  return { getAudioTracks: () => tracks };
}

// Límite de duración
check(MAX_RECORDING_MS, 10 * 60 * 1000, "el límite es de 10 minutos");
check(isRecordingTooLong(0), false, "recién iniciada");
check(isRecordingTooLong(MAX_RECORDING_MS - 1), false, "justo antes del límite");
check(isRecordingTooLong(MAX_RECORDING_MS), true, "en el límite");
check(isRecordingTooLong(MAX_RECORDING_MS + 5000), true, "después del límite");
check(isRecordingTooLong(1000, 500), true, "acepta un límite personalizado");
check(isRecordingTooLong(NaN), false, "tiempo inválido no corta la grabación");
check(isRecordingTooLong(undefined), false, "tiempo ausente no corta la grabación");

// Desconexión del micrófono
const first = fakeTrack();
const second = fakeTrack();
let ended = 0;
const stop = watchTrackEnded(fakeStream([first, second]), () => { ended += 1; });
check(first.count("ended"), 1, "escucha cada pista");
first.emit("ended");
second.emit("ended");
check(ended, 1, "avisa una sola vez aunque terminen varias pistas");
stop();
check(first.count("ended"), 0, "retira los oyentes al detenerse");
check(second.count("ended"), 0, "retira los oyentes de todas las pistas");

const quiet = fakeTrack();
let quietEnded = 0;
const stopQuiet = watchTrackEnded(fakeStream([quiet]), () => { quietEnded += 1; });
stopQuiet();
quiet.emit("ended");
check(quietEnded, 0, "no avisa después de retirar los oyentes");

check(typeof watchTrackEnded(undefined, () => {}), "function", "tolera un stream ausente");
check(typeof watchTrackEnded(fakeStream([]), () => {}), "function", "tolera un stream sin pistas");
check(typeof watchTrackEnded({}, () => {}), "function", "tolera un objeto que no es stream");
watchTrackEnded(undefined, () => {})();
checks += 1;

// Mensajes
check(INTERRUPT_REASON.MICROPHONE_LOST, "microphone-lost", "razón: micrófono perdido");
check(interruptMessage(INTERRUPT_REASON.MICROPHONE_LOST).includes("micrófono"), true, "mensaje del micrófono");
check(interruptMessage(INTERRUPT_REASON.TIME_LIMIT).includes("10 minutos"), true, "mensaje del límite");
check(interruptMessage(INTERRUPT_REASON.SYSTEM_SLEEP).length > 0, true, "mensaje de suspensión");
check(interruptMessage(INTERRUPT_REASON.SCREEN_LOCKED).length > 0, true, "mensaje de bloqueo");
check(interruptMessage("desconocida").length > 0, true, "razón desconocida tiene mensaje genérico");

console.log(`Recording safety: ${checks} checks passed.`);
