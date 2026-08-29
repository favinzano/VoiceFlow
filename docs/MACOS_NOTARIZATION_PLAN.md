# Plan de notarización de macOS (Opción B)

> Objetivo: firmar con **Apple Developer ID** + **notarizar** los builds de macOS para que la app:
> 1. abra sin el aviso "desarrollador no identificado" (Gatekeeper),
> 2. se **auto-actualice** de verdad (Squirrel.Mac requiere firma + ZIP),
> 3. conserve de forma estable el permiso de **Accesibilidad** (TCC confía en la identidad firmada).
>
> Estas tres fricciones vienen todas de la firma **ad-hoc** actual (Opción A). La notarización las elimina de raíz.

Estado: **PENDIENTE** — a la espera de que el propietario complete la Fase 0 (cuenta Apple + credenciales).

---

## Fase 0 — Lo que necesita Felipe (lado Apple)

Nada de esto lo puede hacer Claude: son credenciales personales. Claude solo cablea el CI para **referenciar** los secretos; los **valores** los cargas tú en GitHub.

1. **Apple Developer Program** — US$99/año. Inscríbete en <https://developer.apple.com/programs/> (individual o como organización "felipe avinzano"). La aprobación puede tardar de horas a ~2 días.
2. **Certificado "Developer ID Application"** (para distribución FUERA de la App Store, que es nuestro caso):
   - En un Mac: Xcode → Settings → Accounts → Manage Certificates → `+` → **Developer ID Application**. O en el portal con un CSR.
   - Expórtalo desde Keychain como **`.p12`** con contraseña. Guarda esa contraseña.
   - Anota el **Team ID** (portal → Membership).
3. **Credencial de notarización — recomendado: App Store Connect API Key** (evita problemas de 2FA en CI):
   - App Store Connect → Users and Access → **Integrations / Keys** → genera una key con rol "Developer".
   - Descarga el archivo **`.p8`** (¡solo se descarga una vez!), y anota **Key ID** e **Issuer ID**.
   - _Alternativa_ (más simple pero con Apple ID): password específico de app en <https://appleid.apple.com> → Seguridad → Contraseñas específicas de apps, junto con tu Apple ID y Team ID.
4. **Cargar los secretos en GitHub** (repo `favinzano/VoiceFlow` → Settings → Secrets and variables → Actions → New repository secret). Claude te dará los nombres exactos; los valores los pegas tú:
   - `CSC_LINK` = el `.p12` en base64 (`base64 -i cert.p12 | pbcopy`).
   - `CSC_KEY_PASSWORD` = contraseña del `.p12`.
   - **Vía API key:** `APPLE_API_KEY` (el `.p8` en base64 o su contenido), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`.
   - **Vía Apple ID (alternativa):** `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.

> ⚠️ Claude nunca ve ni maneja el `.p12`, el `.p8` ni las contraseñas. Se cargan directamente como secretos cifrados de GitHub.

---

## Fase 1 — Lo que configura Claude (repo/CI)

Todo esto es una PR reversible. Sin los secretos de la Fase 0, el build simplemente fallaría al firmar, así que se aterriza junto con la Fase 0.

1. **`package.json` → `build.mac`:**
   - `hardenedRuntime: true` (obligatorio para notarizar; hoy está en `false`).
   - Quitar `identity: "-"` (la firma ad-hoc); electron-builder tomará el cert "Developer ID Application" del keychain.
   - `entitlements` y `entitlementsInherit` → `build/entitlements.mac.plist` (ver abajo).
   - `notarize: { teamId: "<TEAM_ID>" }` (o por variable de entorno).
   - **Añadir target `zip`** a `mac.target` junto a `dmg` (arm64 + x64). Squirrel.Mac descarga el `.zip`, no el `.dmg` → sin esto no hay auto-update aunque esté firmado.
   - `mac.icon` ya está configurado ✔.

2. **`build/entitlements.mac.plist`** (crítico — con hardened runtime, sin estos entitlements la app notarizada CRASHEA al cargar los módulos nativos onnxruntime / sharp / nut-js):
   - `com.apple.security.cs.allow-jit` (Electron/V8).
   - `com.apple.security.cs.allow-unsigned-executable-memory` (V8).
   - `com.apple.security.cs.disable-library-validation` (cargar `.node`/`.dylib` de terceros).
   - `com.apple.security.device.audio-input` (micrófono; `NSMicrophoneUsageDescription` ya está en `extendInfo`).

3. **`.github/workflows/release.yml` (job macOS):**
   - Quitar `CSC_IDENTITY_AUTO_DISCOVERY: "false"` (para que descubra el cert).
   - Inyectar los secretos como env: `CSC_LINK`, `CSC_KEY_PASSWORD`, y los de notarización (`APPLE_API_KEY*` o `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID`).
   - electron-builder firma + notariza + **staplea** durante `electron-builder --mac`.
   - Mantener el paso de **sharp cross-arch** (sigue siendo necesario).
   - Verificación post-build: `codesign --verify --deep --strict`, `spctl -a -t exec -vvv` debe decir *"accepted, source=Notarized Developer ID"*, y `xcrun stapler validate`.

4. **`electron-builder.publish`** ya apunta a `favinzano/VoiceFlow` ✔ (para el feed de auto-update).

---

## Fase 2 — Release y verificación

1. Cortar `v1.3.0` (bump menor: cambia el modelo de distribución).
2. En un **Mac limpio** confirmar:
   - Doble clic abre **sin** aviso de Gatekeeper.
   - El auto-update descarga e **instala solo** (probar desde una versión previa).
   - El permiso de **Accesibilidad** se concede una vez y **se mantiene** tras actualizar.
3. Actualizar `PRODUCTION_READINESS.md` (retirar la nota de "sin notarización") y `README.md` (quitar las instrucciones de "clic derecho → Abrir").

---

## Costo / esfuerzo / riesgos

- **Costo:** US$99/año (Apple Developer).
- **Esfuerzo:** ~1–2 h de config de Claude + tu setup de cert/key. Notarizar añade ~2–5 min por build de Mac (servicio notario de Apple).
- **Riesgo principal:** los entitlements. Si falta `disable-library-validation`, la app notarizada **crashea** al cargar onnxruntime/sharp. Ya está contemplado arriba.
- **Windows:** sin cambios (su auto-update ya funciona). La firma Authenticode de Windows es un tema aparte (opcional, otro costo) y NO es parte de este plan.

---

## Checklist rápido para retomar

- [ ] Fase 0: membresía Apple activa
- [ ] Fase 0: cert Developer ID Application (`.p12`) + password
- [ ] Fase 0: App Store Connect API key (`.p8`, Key ID, Issuer ID) **o** app-specific password
- [ ] Fase 0: secretos cargados en GitHub Actions
- [ ] Fase 1: PR de Claude (hardened runtime + entitlements + notarize + zip target + workflow)
- [ ] Fase 2: release `v1.3.0` notarizado y verificado en Mac limpio
- [ ] Fase 2: docs actualizadas
