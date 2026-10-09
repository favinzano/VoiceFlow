"use strict";

const assert = require("node:assert/strict");
const { assertHoldModeAvailable, assertKeyHookPermissions } = require("./key-hook-permissions.cjs");

let checks = 0;
function fakePreferences(trusted) {
  const calls = [];
  return { calls, isTrustedAccessibilityClient: (prompt) => { calls.push(prompt); return trusted; } };
}

// macOS sin permiso: error claro; el aviso del sistema solo aparece si el usuario lo provocó
{
  const preferences = fakePreferences(false);
  assert.throws(() => assertKeyHookPermissions({ platform: "darwin", systemPreferences: preferences }), /Accesibilidad/);
  assert.deepEqual(preferences.calls, [false], "sin prompt solo consulta");
  checks += 2;
}
{
  const preferences = fakePreferences(false);
  assert.throws(() => assertKeyHookPermissions({ platform: "darwin", systemPreferences: preferences, prompt: true }), /Supervisión de entrada/);
  assert.deepEqual(preferences.calls, [false, true], "con prompt pide el permiso una vez");
  checks += 2;
}
{
  const preferences = fakePreferences(true);
  assertKeyHookPermissions({ platform: "darwin", systemPreferences: preferences, prompt: true });
  assert.deepEqual(preferences.calls, [false], "con permiso no vuelve a pedirlo");
  checks += 1;
}
for (const platform of ["linux", "win32"]) {
  const preferences = fakePreferences(false);
  assertKeyHookPermissions({ platform, systemPreferences: preferences });
  assert.deepEqual(preferences.calls, [], `${platform} no consulta permisos de macOS`);
  checks += 1;
}

// Disponibilidad del modo mantener
assertHoldModeAvailable({ shortcutModes: ["toggle", "hold"] });
assert.throws(() => assertHoldModeAvailable({ shortcutModes: ["toggle"], holdUnavailableReason: "wayland" }), /X11/);
assert.throws(() => assertHoldModeAvailable({ shortcutModes: ["toggle"] }), /no está disponible/);
checks += 3;

console.log(`Key hook permissions: ${checks} checks passed.`);
