"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createHoldTracker, createKeyHook, parseAccelerator } = require("./hold-shortcut.cjs");

let checks = 0;
function check(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
  checks += 1;
}

// Tabla reducida con los mismos nombres que UiohookKey.
const KEYS = Object.freeze({
  Space: 57, Enter: 28, Escape: 1, Tab: 15, A: 30, S: 31, V: 47, 0: 11, F9: 67, F13: 91,
  Comma: 51, Minus: 12, ArrowUp: 57416,
  Ctrl: 29, CtrlRight: 3613, Alt: 56, AltRight: 3640, Shift: 42, ShiftRight: 54, Meta: 3675, MetaRight: 3676
});

function key(type, keycode, flags = {}) {
  return { type, keycode, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...flags };
}

// Interpretación de atajos
check(
  parseAccelerator("CommandOrControl+Shift+Space", { platform: "darwin", keys: KEYS }),
  { keycode: 57, ctrl: false, alt: false, shift: true, meta: true },
  "CommandOrControl es Cmd en macOS"
);
check(
  parseAccelerator("CommandOrControl+Shift+Space", { platform: "linux", keys: KEYS }),
  { keycode: 57, ctrl: true, alt: false, shift: true, meta: false },
  "CommandOrControl es Ctrl en Linux"
);
check(parseAccelerator("ctrl+alt+s", { platform: "linux", keys: KEYS }), { keycode: 31, ctrl: true, alt: true, shift: false, meta: false }, "minúsculas");
check(parseAccelerator("Option+A", { platform: "darwin", keys: KEYS }).alt, true, "Option es Alt");
check(parseAccelerator("Cmd+V", { platform: "darwin", keys: KEYS }).meta, true, "Cmd");
check(parseAccelerator("Super+A", { platform: "linux", keys: KEYS }).meta, true, "Super");
check(parseAccelerator("F9", { platform: "linux", keys: KEYS }), { keycode: 67, ctrl: false, alt: false, shift: false, meta: false }, "tecla sola");
check(parseAccelerator("Ctrl+F13", { platform: "linux", keys: KEYS }).keycode, 91, "teclas de función altas");
check(parseAccelerator("Ctrl+Return", { platform: "linux", keys: KEYS }).keycode, 28, "Return es Enter");
check(parseAccelerator("Ctrl+Esc", { platform: "linux", keys: KEYS }).keycode, 1, "Esc es Escape");
check(parseAccelerator("Ctrl+Up", { platform: "linux", keys: KEYS }).keycode, 57416, "flechas");
check(parseAccelerator("Ctrl+,", { platform: "linux", keys: KEYS }).keycode, 51, "puntuación");
check(parseAccelerator("Ctrl+0", { platform: "linux", keys: KEYS }).keycode, 11, "dígitos");

assert.throws(() => parseAccelerator("", { platform: "linux", keys: KEYS }), /atajo/i);
assert.throws(() => parseAccelerator("Ctrl+Shift", { platform: "linux", keys: KEYS }), /tecla principal/i);
assert.throws(() => parseAccelerator("Ctrl+A+S", { platform: "linux", keys: KEYS }), /una sola tecla/i);
assert.throws(() => parseAccelerator("Ctrl+Banana", { platform: "linux", keys: KEYS }), /no admitida/i);
assert.throws(() => parseAccelerator("AltGr+A", { platform: "linux", keys: KEYS }), /no admitida/i);
assert.throws(() => parseAccelerator(null, { platform: "linux", keys: KEYS }), /atajo/i);
checks += 6;

// Seguimiento de pulsar y soltar
function trackerFor(accelerator, platform = "linux") {
  const log = [];
  const tracker = createHoldTracker(parseAccelerator(accelerator, { platform, keys: KEYS }), {
    keys: KEYS,
    onPressed: () => log.push("pressed"),
    onReleased: () => log.push("released")
  });
  return { tracker, log };
}

{
  const { tracker, log } = trackerFor("Ctrl+Space");
  tracker.handle(key("keydown", 29, { ctrlKey: true }));
  check(log, [], "solo el modificador no activa");
  tracker.handle(key("keydown", 57, { ctrlKey: true }));
  check(log, ["pressed"], "el atajo completo activa");
  tracker.handle(key("keydown", 57, { ctrlKey: true }));
  tracker.handle(key("keydown", 57, { ctrlKey: true }));
  check(log, ["pressed"], "la repetición automática no vuelve a activar");
  tracker.handle(key("keyup", 57, { ctrlKey: true }));
  check(log, ["pressed", "released"], "soltar la tecla principal termina");
  tracker.handle(key("keyup", 57, { ctrlKey: true }));
  tracker.handle(key("keyup", 29));
  check(log, ["pressed", "released"], "soltar de nuevo no repite");
}

{
  const { tracker, log } = trackerFor("Ctrl+Space");
  tracker.handle(key("keydown", 57, { ctrlKey: true }));
  tracker.handle(key("keyup", 29));
  check(log, ["pressed", "released"], "soltar el modificador primero también termina");
}

{
  const { tracker, log } = trackerFor("Ctrl+Space");
  tracker.handle(key("keydown", 3613, { ctrlKey: true }));
  tracker.handle(key("keydown", 57, { ctrlKey: true }));
  tracker.handle(key("keyup", 3613));
  check(log, ["pressed", "released"], "el Ctrl derecho cuenta como modificador");
}

{
  // El gancho nativo a veces informa mal las banderas (p. ej. altKey en Windows): se siguen las teclas.
  const { tracker, log } = trackerFor("Ctrl+Alt+Space");
  tracker.handle(key("keydown", 56));
  tracker.handle(key("keydown", 29, { ctrlKey: true }));
  tracker.handle(key("keydown", 57, { ctrlKey: true }));
  check(log, ["pressed"], "activa aunque la bandera altKey llegue en falso");
  tracker.handle(key("keyup", 57, { ctrlKey: true }));
  tracker.handle(key("keyup", 29));
  tracker.handle(key("keyup", 56));
  check(log, ["pressed", "released"], "termina al soltar");
  tracker.handle(key("keydown", 57, { ctrlKey: true }));
  check(log, ["pressed", "released"], "tras soltar los modificadores ya no se activa solo con la bandera de Ctrl");
}

{
  const { tracker, log } = trackerFor("Ctrl+Space");
  tracker.handle(key("keydown", 42));
  tracker.handle(key("keydown", 29, { ctrlKey: true }));
  tracker.handle(key("keydown", 57, { ctrlKey: true }));
  check(log, [], "un modificador de más pulsado (aunque su bandera falle) no activa");
  tracker.handle(key("keyup", 42));
  tracker.handle(key("keydown", 57, { ctrlKey: true }));
  check(log, ["pressed"], "al soltar el modificador de más vuelve a activar");
}

{
  const { tracker, log } = trackerFor("Ctrl+Space");
  tracker.handle(key("keydown", 57));
  check(log, [], "sin el modificador no activa");
  tracker.handle(key("keydown", 57, { ctrlKey: true, shiftKey: true }));
  check(log, [], "con un modificador de más no activa");
  tracker.handle(key("keydown", 30, { ctrlKey: true }));
  tracker.handle(key("keyup", 30, { ctrlKey: true }));
  check(log, [], "otras teclas se ignoran");
}

{
  const { tracker, log } = trackerFor("Ctrl+Space");
  tracker.handle(key("keydown", 57, { ctrlKey: true }));
  tracker.handle(key("keydown", 30, { ctrlKey: true }));
  tracker.handle(key("keyup", 30, { ctrlKey: true }));
  check(log, ["pressed"], "pulsar otra tecla mientras se mantiene no termina");
  tracker.reset();
  check(log, ["pressed", "released"], "reset termina una pulsación activa");
  tracker.reset();
  check(log, ["pressed", "released"], "reset sin pulsación activa no hace nada");
}

{
  const { tracker, log } = trackerFor("F9");
  tracker.handle(key("keydown", 67));
  tracker.handle(key("keyup", 67));
  check(log, ["pressed", "released"], "tecla sola");
}

{
  const log = [];
  const tracker = createHoldTracker(parseAccelerator("Ctrl+Space", { platform: "linux", keys: KEYS }), {
    keys: KEYS,
    onPressed: () => { throw new Error("fallo del oyente"); },
    onReleased: () => log.push("released"),
    onError: (error) => log.push(error.message)
  });
  tracker.handle(key("keydown", 57, { ctrlKey: true }));
  check(log, ["fallo del oyente"], "un error del oyente se informa y no rompe el seguimiento");
  tracker.handle(key("keyup", 57, { ctrlKey: true }));
  check(log, ["fallo del oyente", "released"], "sigue funcionando después del error");
}

// Gancho global compartido
function fakeHook() {
  const uIOhook = new EventEmitter();
  uIOhook.started = 0;
  uIOhook.stopped = 0;
  uIOhook.start = () => { uIOhook.started += 1; };
  uIOhook.stop = () => { uIOhook.stopped += 1; };
  return uIOhook;
}

{
  const uIOhook = fakeHook();
  let loads = 0;
  const hook = createKeyHook({ loadUiohook: () => { loads += 1; return { uIOhook, UiohookKey: KEYS }; }, platform: "linux" });
  check(loads, 0, "no carga la librería hasta que se necesita");

  const log = [];
  const watcher = hook.watch("Ctrl+Space", { onPressed: () => log.push("pressed"), onReleased: () => log.push("released") });
  check([loads, uIOhook.started], [1, 1], "carga y arranca una vez");
  uIOhook.emit("keydown", key("keydown", 57, { ctrlKey: true }));
  uIOhook.emit("keyup", key("keyup", 57, { ctrlKey: true }));
  check(log, ["pressed", "released"], "reenvía los eventos de teclado");

  const second = hook.watch("F9", { onPressed: () => log.push("second"), onReleased: () => {} });
  check(uIOhook.started, 1, "un segundo atajo comparte el mismo gancho");
  uIOhook.emit("keydown", key("keydown", 67));
  check(log, ["pressed", "released", "second"], "cada atajo recibe lo suyo");

  watcher.stop();
  check(uIOhook.stopped, 0, "no detiene el gancho mientras queden atajos");
  uIOhook.emit("keydown", key("keydown", 57, { ctrlKey: true }));
  check(log, ["pressed", "released", "second"], "un atajo detenido deja de recibir eventos");

  second.stop();
  check(uIOhook.stopped, 1, "detiene el gancho al quitar el último atajo");
  check(uIOhook.listenerCount("keydown") + uIOhook.listenerCount("keyup"), 0, "no deja oyentes colgando");
  second.stop();
  check(uIOhook.stopped, 1, "detener dos veces es inocuo");
}

{
  // Tras bloquear la pantalla o suspender se pierde el "soltar": reset() deja el atajo listo de nuevo.
  const uIOhook = fakeHook();
  const hook = createKeyHook({ loadUiohook: () => ({ uIOhook, UiohookKey: KEYS }), platform: "linux" });
  const log = [];
  const watcher = hook.watch("Ctrl+Space", { onPressed: () => log.push("pressed"), onReleased: () => log.push("released") });
  uIOhook.emit("keydown", key("keydown", 57, { ctrlKey: true }));
  watcher.reset();
  check(log, ["pressed", "released"], "reset libera una pulsación atascada");
  uIOhook.emit("keydown", key("keydown", 57, { ctrlKey: true }));
  check(log, ["pressed", "released", "pressed"], "tras reset la siguiente pulsación vuelve a funcionar");
  watcher.stop();
  watcher.reset();
  check(uIOhook.stopped, 1, "reset después de detener es inocuo");
}

{
  const uIOhook = fakeHook();
  const hook = createKeyHook({ loadUiohook: () => ({ uIOhook, UiohookKey: KEYS }), platform: "linux" });
  const log = [];
  const watcher = hook.watch("Ctrl+Space", { onPressed: () => log.push("pressed"), onReleased: () => log.push("released") });
  uIOhook.emit("keydown", key("keydown", 57, { ctrlKey: true }));
  watcher.stop();
  check(log, ["pressed", "released"], "detener con la tecla pulsada libera la grabación");
}

{
  const hook = createKeyHook({ loadUiohook: () => { throw new Error("módulo ausente"); }, platform: "linux" });
  assert.throws(() => hook.watch("Ctrl+Space", { onPressed() {}, onReleased() {} }), /modo mantener|módulo ausente/i);
  checks += 1;

  const failing = fakeHook();
  failing.start = () => { throw new Error("sin permiso"); };
  const failingHook = createKeyHook({ loadUiohook: () => ({ uIOhook: failing, UiohookKey: KEYS }), platform: "linux" });
  assert.throws(() => failingHook.watch("Ctrl+Space", { onPressed() {}, onReleased() {} }), /sin permiso/);
  check(failing.listenerCount("keydown"), 0, "si el gancho no arranca no deja oyentes");

  assert.throws(
    () => createKeyHook({ loadUiohook: () => ({ uIOhook: fakeHook(), UiohookKey: KEYS }), platform: "linux" })
      .watch("Ctrl+Banana", { onPressed() {}, onReleased() {} }),
    /no admitida/i
  );
  checks += 1;
}

console.log(`Hold shortcut: ${checks} checks passed.`);
