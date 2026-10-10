# Tareas: Puerta de "sin voz"

Orden por dependencia. Ver `tasks/plan.md` para el diseño.

- [x] **T1: `getSummary()` en el detector de voz**
  - Acceptance: `createVoiceActivityDetector().getSummary()` devuelve `{ speechDetected, speechMs }`; `speechMs` suma los intervalos con `rms >= speechThreshold`, cada uno acotado a 250 ms; `update()` conserva firma y comportamiento.
  - Verify: `node src/voice-activity.test.cjs` (los 41 checks existentes siguen pasando + nuevos para resumen con cadencias de 50/100/200 ms).
  - Files: `src/voice-activity.cjs`, `src/voice-activity.test.cjs`

- [x] **T2: módulo `speech-gate`**
  - Acceptance: `evaluateSpeechGate(summary, { minimumSpeechMs = 300 })` devuelve `{ hasSpeech, speechMs }`; rechaza silencio, ruido estacionario, clic y voz de 200 ms; acepta voz de 400 ms; sin resumen ⇒ `hasSpeech: true`.
  - Verify: `node src/speech-gate.test.cjs`
  - Files: `src/speech-gate.cjs`, `src/speech-gate.test.cjs`

- [x] **Checkpoint de riesgo: RMS de voz real** (superado 2026-10-09, TONOR TC-2030: voz normal p90 0.112, voz baja p90 0.023, 3.3 s de voz contados; ver `tasks/plan.md`)
  - Acceptance: medido el RMS de voz normal y baja en el equipo de referencia; confirmado que supera `speechThreshold` (0.008) con margen. Si no, se detiene el plan y se pregunta antes de tocar umbrales.
  - Verify: lectura manual con el mic seleccionado; resultado anotado en `tasks/plan.md`.
  - Files: ninguno (medición)

- [x] **T3: corpus sintético de pausas** (archivo separado `src/voice-activity-corpus.test.cjs`; registrar en T5)
  - Acceptance: generador con semilla fija; cortes prematuros del auto-stop <1% con `silenceTimeoutMs` 1800 y pausas internas de 0.5–1.5 s; casos de silencio, ruido y clic no producen voz.
  - Verify: `node src/voice-activity.test.cjs` (o el archivo de corpus si se separa).
  - Files: `src/voice-activity.test.cjs` (o `src/voice-activity-corpus.test.cjs`)

- [x] **T4: cableado en `renderer.js`** (prueba manual hecha por el usuario, todo bien)
  - Acceptance: el detector se alimenta aunque `autoStopEnabled` sea false; resumen tomado antes de `releaseAudioCapture`; sin voz ⇒ no se llama a `processAudio`, se cancela la sesión, `lastAudio = undefined`, aviso en overlay + toast, nada en historial; bloque de cancelación repetido extraído a una función local.
  - Verify: `npm run build` y `npm test`; prueba manual de los 5 casos (silencio, golpe, frase corta, frase con pausas, hold-to-talk).
  - Files: `src/renderer.js`

- [x] **T5: registro en scripts y roadmap**
  - Acceptance: los tests nuevos corren en `npm test` y `npm run test:production`; la sección del roadmap refleja el estado real.
  - Verify: `npm test` ejecuta `speech-gate.test.cjs` (visible en la salida).
  - Files: `package.json`, `docs/PRODUCT_HARDENING_ROADMAP.md`

- [~] **T6: verificación final y revisión** (`test:production` y `npm test` en verde, revisión sin CRITICAL/HIGH; quedan 2 MEDIUM pendientes de decisión)
  - Acceptance: `npm test` y `npm run test:production` en verde; sin llamadas de red nuevas; revisión de código sin hallazgos CRITICAL/HIGH.
  - Verify: ambos comandos + agente `code-reviewer` sobre el diff.
  - Files: ninguno
