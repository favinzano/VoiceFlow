"use strict";

// Modo mantener (push-to-talk) para macOS y Linux. Electron solo avisa cuando se pulsa un
// atajo global, no cuando se suelta, así que aquí se escucha el teclado con uiohook-napi y
// se detecta pulsar y soltar. En Windows se sigue usando el helper nativo existente.

const MODIFIER_NAMES = Object.freeze({
  commandorcontrol: "commandorcontrol",
  cmdorctrl: "commandorcontrol",
  command: "meta",
  cmd: "meta",
  super: "meta",
  meta: "meta",
  control: "ctrl",
  ctrl: "ctrl",
  alt: "alt",
  option: "alt",
  shift: "shift"
});

const KEY_ALIASES = Object.freeze({
  space: "Space",
  enter: "Enter",
  return: "Enter",
  tab: "Tab",
  escape: "Escape",
  esc: "Escape",
  backspace: "Backspace",
  delete: "Delete",
  insert: "Insert",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  ",": "Comma",
  ".": "Period",
  "/": "Slash",
  ";": "Semicolon",
  "'": "Quote",
  "`": "Backquote",
  "[": "BracketLeft",
  "]": "BracketRight",
  "\\": "Backslash",
  "-": "Minus",
  "=": "Equal"
});

function unsupported(token) {
  return new Error(`Tecla no admitida en el modo mantener: ${token}`);
}

function resolveKeyName(token, keys) {
  const lower = token.toLowerCase();
  if (KEY_ALIASES[lower]) return KEY_ALIASES[lower];
  if (/^f([1-9]|1\d|2[0-4])$/.test(lower)) return lower.toUpperCase();
  if (/^[a-z]$/.test(lower)) return lower.toUpperCase();
  if (/^[0-9]$/.test(lower)) return lower;
  return Object.hasOwn(keys, token) ? token : undefined;
}

function parseAccelerator(accelerator, { platform = process.platform, keys } = {}) {
  if (typeof accelerator !== "string" || !accelerator.trim()) throw new Error("El atajo está vacío.");
  const modifiers = { ctrl: false, alt: false, shift: false, meta: false };
  let keycode;
  for (const rawToken of accelerator.split("+")) {
    const token = rawToken.trim();
    if (!token) throw unsupported(accelerator);
    const modifier = MODIFIER_NAMES[token.toLowerCase()];
    if (modifier) {
      if (modifier === "commandorcontrol") modifiers[platform === "darwin" ? "meta" : "ctrl"] = true;
      else modifiers[modifier] = true;
      continue;
    }
    if (keycode !== undefined) throw new Error("El atajo debe tener una sola tecla principal (una sola tecla además de los modificadores).");
    const name = resolveKeyName(token, keys);
    if (!name || !Number.isInteger(keys[name])) throw unsupported(token);
    keycode = keys[name];
  }
  if (keycode === undefined) throw new Error("El atajo necesita una tecla principal además de los modificadores.");
  return { keycode, ...modifiers };
}

function modifierKeycodes(parsed, keys) {
  const codes = new Set();
  if (parsed.ctrl) [keys.Ctrl, keys.CtrlRight].forEach((code) => codes.add(code));
  if (parsed.alt) [keys.Alt, keys.AltRight].forEach((code) => codes.add(code));
  if (parsed.shift) [keys.Shift, keys.ShiftRight].forEach((code) => codes.add(code));
  if (parsed.meta) [keys.Meta, keys.MetaRight].forEach((code) => codes.add(code));
  codes.delete(undefined);
  return codes;
}

function modifierGroups(keys) {
  const group = (...codes) => new Set(codes.filter((code) => code !== undefined));
  return {
    ctrl: group(keys.Ctrl, keys.CtrlRight),
    alt: group(keys.Alt, keys.AltRight),
    shift: group(keys.Shift, keys.ShiftRight),
    meta: group(keys.Meta, keys.MetaRight)
  };
}

function createHoldTracker(parsed, { keys, onPressed, onReleased, onError = (error) => console.error("Hold shortcut handler failed:", error) }) {
  const releaseCodes = modifierKeycodes(parsed, keys);
  const groups = modifierGroups(keys);
  // El gancho nativo no siempre rellena bien las banderas de modificadores (p. ej. altKey en
  // Windows), así que además se recuerda qué teclas modificadoras están pulsadas.
  const held = { ctrl: false, alt: false, shift: false, meta: false };
  let active = false;

  function notify(callback) {
    try {
      callback();
    } catch (error) {
      onError(error);
    }
  }

  function trackModifiers(event) {
    const pressed = event.type === "keydown";
    for (const [name, codes] of Object.entries(groups)) {
      if (codes.has(event.keycode)) held[name] = pressed;
    }
  }

  function modifiersMatch(event) {
    return (held.ctrl || Boolean(event.ctrlKey)) === parsed.ctrl
      && (held.alt || Boolean(event.altKey)) === parsed.alt
      && (held.shift || Boolean(event.shiftKey)) === parsed.shift
      && (held.meta || Boolean(event.metaKey)) === parsed.meta;
  }

  function release() {
    active = false;
    notify(onReleased);
  }

  return {
    handle(event) {
      trackModifiers(event);
      if (event.type === "keydown") {
        if (event.keycode !== parsed.keycode || active || !modifiersMatch(event)) return;
        active = true;
        notify(onPressed);
        return;
      }
      if (event.type !== "keyup" || !active) return;
      if (event.keycode === parsed.keycode || releaseCodes.has(event.keycode)) release();
    },
    reset() {
      if (active) release();
    },
    isActive: () => active
  };
}

// Un solo gancho global de teclado compartido por todos los atajos observados.
function createKeyHook({ loadUiohook, platform = process.platform }) {
  let loaded;
  const watchers = new Set();
  let attached = false;

  function load() {
    if (loaded) return loaded;
    try {
      loaded = loadUiohook();
    } catch (error) {
      throw new Error(`El modo mantener no está disponible en este sistema: ${error.message}`);
    }
    return loaded;
  }

  const dispatch = (type) => (event) => {
    for (const tracker of [...watchers]) tracker.handle({ ...event, type });
  };
  const onKeyDown = dispatch("keydown");
  const onKeyUp = dispatch("keyup");

  function attach(uIOhook) {
    uIOhook.on("keydown", onKeyDown);
    uIOhook.on("keyup", onKeyUp);
    attached = true;
  }

  function detach(uIOhook) {
    uIOhook.removeListener("keydown", onKeyDown);
    uIOhook.removeListener("keyup", onKeyUp);
    attached = false;
  }

  function watch(accelerator, { onPressed, onReleased, onError }) {
    const { uIOhook, UiohookKey } = load();
    const parsed = parseAccelerator(accelerator, { platform, keys: UiohookKey });
    const tracker = createHoldTracker(parsed, { keys: UiohookKey, onPressed, onReleased, onError });
    const startedHere = !attached;
    watchers.add(tracker);
    if (startedHere) {
      attach(uIOhook);
      try {
        uIOhook.start();
      } catch (error) {
        watchers.delete(tracker);
        detach(uIOhook);
        throw error;
      }
    }
    let stopped = false;
    return {
      // Descarta una pulsación en curso (p. ej. tras bloquear la pantalla, cuando el "soltar" se pierde).
      reset() {
        if (!stopped) tracker.reset();
      },
      stop() {
        if (stopped) return;
        stopped = true;
        tracker.reset();
        watchers.delete(tracker);
        if (!watchers.size && attached) {
          detach(uIOhook);
          uIOhook.stop();
        }
      }
    };
  }

  return { watch };
}

module.exports = { createHoldTracker, createKeyHook, parseAccelerator };
