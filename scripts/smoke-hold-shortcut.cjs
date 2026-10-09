"use strict";

// Humo manual del modo mantener (macOS/Linux; también corre en Windows).
// Engancha el teclado real con uiohook-napi, mantiene Ctrl+Alt+F13 durante ~400 ms mediante
// nut-js y comprueba que se detectan "pulsar" y "soltar" en ese orden.
//
// Requisitos: una sesión gráfica (X11 en Linux) y, en macOS, el permiso de Accesibilidad para
// la terminal desde la que se ejecuta. Uso: node scripts/smoke-hold-shortcut.cjs

const { createKeyHook } = require("../src/hold-shortcut.cjs");

const ACCELERATOR = "Ctrl+Alt+F13";
const HOLD_MS = 400;
const TIMEOUT_MS = 5000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  const { keyboard, Key } = require("@nut-tree-fork/nut-js");
  const hook = createKeyHook({ loadUiohook: () => require("uiohook-napi"), platform: process.platform });
  const events = [];
  const startedAt = Date.now();
  const watcher = hook.watch(ACCELERATOR, {
    onPressed: () => events.push(["pressed", Date.now() - startedAt]),
    onReleased: () => events.push(["released", Date.now() - startedAt])
  });
  try {
    await sleep(300);
    const modifiers = [Key.LeftControl, Key.LeftAlt];
    await keyboard.pressKey(...modifiers, Key.F13);
    await sleep(HOLD_MS);
    await keyboard.releaseKey(...modifiers, Key.F13);
    const deadline = Date.now() + TIMEOUT_MS;
    while (events.length < 2 && Date.now() < deadline) await sleep(50);
  } finally {
    watcher.stop();
  }

  const order = events.map(([name]) => name).join(",");
  if (order !== "pressed,released") {
    console.error(`FALLO: se esperaba "pressed,released" y se obtuvo "${order || "ningún evento"}".`);
    if (process.platform === "darwin") console.error("En macOS concede Accesibilidad a la terminal y repite.");
    if (process.platform === "linux") console.error("En Linux se necesita X11 (no Wayland nativo) y la variable DISPLAY.");
    process.exitCode = 1;
    return;
  }
  const heldMs = events[1][1] - events[0][1];
  console.log(`OK: pulsar y soltar detectados (mantenido ~${heldMs} ms).`);
  if (heldMs < HOLD_MS * 0.5) {
    console.error("AVISO: el tiempo mantenido es menor al esperado.");
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("FALLO:", error.message || error);
  process.exitCode = 1;
}).finally(() => setTimeout(() => process.exit(process.exitCode || 0), 100));
