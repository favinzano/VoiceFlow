"use strict";

// macOS exige permisos de privacidad para escuchar el teclado global; sin ellos el gancho
// arranca pero no recibe nada. Se comprueba antes de arrancarlo para que el fallo sea claro.
// El aviso del sistema solo se muestra cuando el usuario lo provoca (prompt: true), no en
// cada arranque.
function assertKeyHookPermissions({ platform, systemPreferences, prompt = false }) {
  if (platform !== "darwin" || systemPreferences.isTrustedAccessibilityClient(false)) return;
  if (prompt) systemPreferences.isTrustedAccessibilityClient(true);
  throw new Error(
    "El modo mantener necesita los permisos de Accesibilidad y Supervisión de entrada. "
    + "Concédelos en Ajustes del Sistema > Privacidad y seguridad y vuelve a elegir el modo."
  );
}

function assertHoldModeAvailable(capabilities) {
  if (capabilities.shortcutModes.includes("hold")) return;
  throw new Error(
    capabilities.holdUnavailableReason === "wayland"
      ? "El modo mantener necesita una sesión X11: Wayland no permite escuchar el teclado global."
      : "El modo mantener no está disponible en este sistema."
  );
}

module.exports = { assertHoldModeAvailable, assertKeyHookPermissions };
