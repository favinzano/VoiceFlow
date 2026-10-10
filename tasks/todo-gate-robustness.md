# Tareas: Robustez de la puerta de "sin voz"

Ver `tasks/plan-gate-robustness.md`.

- [x] **T1: historial de niveles en el detector**
  - Acceptance: `getLevels()` devuelve `{ levels, times }` como copias (modificarlas no altera el detector), con un par por llamada a `update`, también después del punto de parada; `update()`/`getSummary()`/auto-stop no cambian.
  - Verify: `node src/voice-activity.test.cjs` (checks existentes + nuevos) y `node src/voice-activity-corpus.test.cjs` sin cambios.
  - Files: `src/voice-activity.cjs`, `src/voice-activity.test.cjs`

- [x] **T2: criterio por tramos en `speech-gate`**
  - Acceptance: `evaluateSpeechGate({ levels, times }, options)` con cadencia mediana, piso por ventanas de 200 ms, `threshold = clamp(2×piso, 0.005, 0.008)`, tramos ≥160 ms, total ≥300 ms; 8+ picos aislados se rechazan; voz de 0.010 sobre ruido de 0.004 pasa; ruido solo se rechaza; voz uniforme sin silencio inicial pasa; falla abierto con datos inválidos; no muta entradas.
  - Verify: `node src/speech-gate.test.cjs`
  - Files: `src/speech-gate.cjs`, `src/speech-gate.test.cjs`

- [x] **T3: corpus del gate (checkpoint sintético)**
  - Acceptance: con semilla fija y cadencia de 40 ms, voz baja sobre ruido pasa ≥99%, ruido solo se descarta ≥99%, grabaciones con 8/15/30 picos aislados se descartan ≥99%, voz normal y los casos del corpus de pausas siguen pasando 100%.
  - Verify: `node src/speech-gate-corpus.test.cjs`
  - Files: `src/speech-gate-corpus.test.cjs`

- [x] **T4: cableado en `renderer.js`**
  - Acceptance: `finishRecording` toma `getLevels()` antes de liberar la captura y decide con el gate nuevo; el resto del flujo (descarte sin rastro, avisos) no cambia.
  - Verify: `npm run build` y `npm test`; prueba manual de silencio, golpe, frase corta y frase con pausas.
  - Files: `src/renderer.js`

- [x] **T5: ampliar el script de medición (checkpoint con tu micrófono)** (medición real: las 4 fases pasan el gate)
  - Acceptance: nueva fase "voz-baja-ruido" (voz baja con ruido de fondo constante) y los veredictos usan el gate nuevo con los mismos datos; el script sigue funcionando con el micrófono sintético.
  - Verify: `npx electron scripts/measure-voice-levels.cjs --fake-mic` y ejecución real tuya.
  - Files: `scripts/measure-voice-levels.cjs`, `scripts/measure-voice-levels.html`

- [x] **T6: cierre**
  - Acceptance: tests nuevos registrados en `test` y `test:production`; roadmap y spec original actualizados (límites resueltos); `npm test` y `npm run test:production` en verde; revisión sin CRITICAL/HIGH.
  - Verify: ambos comandos + agente `code-reviewer`.
  - Files: `package.json`, `docs/PRODUCT_HARDENING_ROADMAP.md`, `docs/superpowers/specs/2026-10-09-no-speech-gate-design.md`
