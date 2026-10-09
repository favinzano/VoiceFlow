'use strict';

const assert = require('node:assert');
const { normalizePlatformSettings, resolvePlatformCapabilities } = require('./platform-capabilities.cjs');

const windows = resolvePlatformCapabilities('win32', true);
assert.deepEqual(windows.inferenceDevices, ['cpu', 'dml']);
assert.deepEqual(windows.shortcutModes, ['toggle', 'hold']);
assert.equal(windows.autoStart, true);

for (const platform of ['darwin', 'linux']) {
  const capabilities = resolvePlatformCapabilities(platform, true);
  assert.deepEqual(capabilities.inferenceDevices, ['cpu']);
  assert.deepEqual(capabilities.shortcutModes, ['toggle', 'hold']);
  assert.equal(capabilities.autoStart, true);
  assert.deepEqual(
    normalizePlatformSettings({ inferenceDevice: 'dml', shortcutMode: 'hold', autoStartEnabled: true }, capabilities),
    { inferenceDevice: 'cpu', shortcutMode: 'hold', autoStartEnabled: true }
  );
}

// Wayland no permite escuchar el teclado global: el modo mantener no se ofrece.
const wayland = resolvePlatformCapabilities('linux', true, { sessionType: 'wayland' });
assert.deepEqual(wayland.shortcutModes, ['toggle']);
assert.equal(wayland.holdUnavailableReason, 'wayland');
assert.equal(normalizePlatformSettings({ shortcutMode: 'hold' }, wayland).shortcutMode, 'toggle');
assert.deepEqual(resolvePlatformCapabilities('linux', true, { sessionType: 'x11' }).shortcutModes, ['toggle', 'hold']);
assert.deepEqual(resolvePlatformCapabilities('linux', true, { sessionType: undefined }).shortcutModes, ['toggle', 'hold']);
assert.equal(resolvePlatformCapabilities('darwin', true, { sessionType: 'wayland' }).shortcutModes.includes('hold'), true);
assert.equal(resolvePlatformCapabilities('win32', true).holdUnavailableReason, undefined);

const development = resolvePlatformCapabilities('linux', false);
assert.equal(development.autoStart, false);
assert.equal(normalizePlatformSettings({ autoStartEnabled: true }, development).autoStartEnabled, false);

const unsupported = resolvePlatformCapabilities('freebsd', true);
assert.equal(unsupported.autoStart, false);
assert.deepEqual(unsupported.inferenceDevices, ['cpu']);

console.log('Platform capabilities: 24 checks passed.');
