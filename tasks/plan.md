# Plan: Puerta de "sin voz" antes de transcribir

Spec aprobada: `docs/superpowers/specs/2026-10-09-no-speech-gate-design.md`
Rama sugerida: `feat/no-speech-gate` desde `main` (ya incluye #13).

## Flujo actual (relevante)

```
worklet rms ─► handleVoiceLevel(rms) ─► voiceActivityDetector.update(rms)   (solo si autoStopEnabled)
finishRecording():
  flushCapture → collectRecording (resample + trimEdgeSilence) → releaseAudioCapture (destruye el detector)
  → gate "muy corto" (<12000 muestras) → gate "peak < 0.002" → processAudio(lastAudio, …)
```

Cada gate de rechazo hace lo mismo: `processing=false`, `transcription.cancel(sessionId)`, limpia `transcriptionSessionId`, `setStatus("idle", …)`, `finishOverlay("error", …)`.

## Componentes y dependencias

```
T1 voice-activity.getSummary ──► T2 speech-gate ──► T4 wiring en renderer ──► T6 verificación
            └──────────────────► T3 corpus de pausas                    ▲
                                  T5 registro en package.json + roadmap ┘
```

- T1 es la base: el gate necesita `speechMs` y `speechDetected` del detector.
- T2 y T3 son independientes entre sí tras T1 (se pueden hacer en paralelo, pero son pequeñas; se hacen en secuencia).
- T4 depende de T2. T5 puede ir con T2/T3 y se cierra al final.

## Diseño por tarea

**T1 — resumen del detector.** `createVoiceActivityDetector` expone `getSummary()` → `{ speechDetected, speechMs }`. `speechMs` suma el tiempo entre llamadas consecutivas a `update()` en las que `rms >= speechThreshold`, con cada intervalo acotado a 250 ms (la primera llamada cuenta 100 ms nominales, igual que el cálculo del piso de ruido). `update()` no cambia de firma ni de comportamiento.

**T2 — `src/speech-gate.cjs`.** Función pura `evaluateSpeechGate(summary, { minimumSpeechMs = 300 })` → `{ hasSpeech, speechMs }`. Sin estado, sin mutar entradas, valida que `summary` sea un objeto con números (falla cerrado: sin resumen ⇒ `hasSpeech: true` para no bloquear dictados si el detector no existe; ver decisión abajo).

**T3 — corpus de pausas.** Test sintético en `voice-activity.test.cjs` (o `voice-activity-corpus.test.cjs` si crece): N frases generadas con generador pseudoaleatorio con semilla fija (como `transcription-smoke.test.cjs`), pausas internas de 0.5–1.5 s con `silenceTimeoutMs` 1800. Mide cortes prematuros (auto-stop antes del fin de la frase). Criterio: <1%. Incluye casos negativos: silencio puro, ruido estacionario, clic.

**T4 — wiring en `renderer.js`** (cambio mínimo, la lógica está en el módulo):
1. `handleVoiceLevel`: llamar a `voiceActivityDetector?.update(rms)` siempre; el auto-stop solo actúa si `settings.autoStopEnabled && !autoStopPending`.
2. `finishRecording`: tomar `const speechSummary = voiceActivityDetector?.getSummary()` **antes** de `releaseAudioCapture()` (el `finally` destruye el detector).
3. Tras los gates "muy corto" y "peak", evaluar `evaluateSpeechGate(speechSummary)`. Si `!hasSpeech`: cancelar la sesión, limpiar `transcriptionSessionId`, **`lastAudio = undefined`** (descarte sin rastro), `setStatus("idle", …)`, `showToast("No se detectó voz.")` y `finishOverlay("error", "No se detectó voz.")`. Nada se pega, nada se guarda en el historial, no se llama a `processAudio`.
4. Extraer el bloque repetido de cancelación a una función local para no añadir una tercera copia (el archivo ya es grande; `CLAUDE.md` pide no engordarlo).

**T5 — registro y docs.** Añadir `node src/speech-gate.test.cjs` (y el corpus si es archivo aparte) a `test` y `test:production` en `package.json` (la CI corre estos scripts; un test no registrado no se ejecuta). Actualizar la sección "Detección automática de silencio" de `docs/PRODUCT_HARDENING_ROADMAP.md` con el estado real.

**T6 — verificación.** `npm test`, `npm run test:production`, y prueba manual en la app (skill `run`): pulsar y soltar en silencio, ruido/golpe en la mesa, frase corta real, frase con pausas, hold-to-talk, auto-stop apagado.

## Riesgos y mitigación

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Micrófonos muy bajos: voz con RMS < 0.008 nunca supera `speechThreshold`, así que `speechMs` sería 0 y **se rechazaría un dictado válido** que hoy sí se transcribe | Alto (regresión) | Checkpoint tras T2: medir RMS de voz real en el equipo de referencia antes de cablear T4. Si el margen es estrecho, **pregunto antes** de bajar el umbral (está en "preguntar antes" de la spec) |
| `speechMs` infravalora si el worklet emite rms con cadencia irregular | Medio | Intervalo acotado a 250 ms y test con cadencias de 50/100/200 ms |
| Frases muy cortas ("sí", "no") de ~250 ms | Bajo | Ya las rechaza hoy el gate de <12000 muestras (0,75 s); no hay regresión |
| Perder el audio para "reprocesar" tras un descarte | Bajo | Es lo acordado (sin rastro); el botón dirá "Todavía no hay una grabación para reprocesar" |
| `renderer.js` no tiene tests unitarios | Medio | Lógica de decisión en módulo puro; el renderer solo la invoca; verificación manual en T6 |

## Resultado del checkpoint de RMS (2026-10-09)

Medido con `scripts/measure-voice-levels.cjs` en el equipo de referencia, micrófono TONOR TC-2030 (la primera medición con "USB Audio Device" 0d8c:0014 capturó silencio en las tres fases y se descartó como inválida).

| Fase | p50 | p90 | máx | % ≥ 0.008 | voz contada |
|---|---|---|---|---|---|
| ambiente | 0.0037 | 0.0045 | 0.0050 | 0% | 0 ms |
| voz normal | 0.0315 | 0.1118 | 0.1874 | 70% | 4170 ms |
| voz baja | 0.0087 | 0.0233 | 0.1512 | 54% | 3339 ms |

Conclusión: el gate (300 ms) pasa con un margen de más de 10x en voz normal. En voz baja, con el piso de ruido adaptado (ambiente máx 0.005 ⇒ umbral adaptativo ≤ 0.015), al menos el 10% de las muestras (p90 = 0.0233) lo supera: ≥14 muestras × 40 ms ≈ 580 ms, unas 1.9x el mínimo. No se tocan umbrales. Un susurro mucho más bajo que "voz baja" sí podría descartarse; queda como límite conocido.

Nota: la cadencia real del worklet es 40 ms (24 Hz), no 100 ms; `speechMs` se acumula por intervalo real, así que no afecta.

## Decisión que tomo por defecto (dime si no te cuadra)

Si por algún motivo no hay detector (`speechSummary` indefinido), el gate **deja pasar** el audio: es preferible transcribir una vez de más que perder un dictado.

## Puntos de control entre fases

- Tras T1+T2: tests en verde y medición de RMS real (checkpoint de riesgo alto).
- Tras T4: `npm test` completo antes de tocar docs.
- Final: `npm run test:production` y revisión de código (el cambio toca 5–6 archivos).
