'use strict';

const SUPPORTED_PLATFORMS = new Set(['win32', 'darwin', 'linux']);

// En Linux, Wayland no deja que una app escuche el teclado global; el modo mantener solo
// se ofrece en X11 (o si no se conoce el tipo de sesión).
function resolveShortcutModes(platform, sessionType) {
  if (platform === 'linux' && String(sessionType || '').toLowerCase() === 'wayland') {
    return { shortcutModes: ['toggle'], holdUnavailableReason: 'wayland' };
  }
  return { shortcutModes: ['toggle', 'hold'] };
}

function resolvePlatformCapabilities(platform = process.platform, isPackaged = false, { sessionType } = {}) {
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    return {
      platform,
      autoStart: false,
      inferenceDevices: ['cpu'],
      shortcutModes: ['toggle']
    };
  }

  return {
    platform,
    autoStart: Boolean(isPackaged),
    inferenceDevices: platform === 'win32' ? ['cpu', 'dml'] : ['cpu'],
    ...resolveShortcutModes(platform, sessionType)
  };
}

function normalizePlatformSettings(settings, capabilities) {
  const normalized = { ...settings };
  if (!capabilities.inferenceDevices.includes(normalized.inferenceDevice)) normalized.inferenceDevice = 'cpu';
  if (!capabilities.shortcutModes.includes(normalized.shortcutMode)) normalized.shortcutMode = 'toggle';
  if (!capabilities.autoStart) normalized.autoStartEnabled = false;
  return normalized;
}

module.exports = { normalizePlatformSettings, resolvePlatformCapabilities };
