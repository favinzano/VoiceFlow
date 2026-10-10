# Plan: Robustez de la puerta de "sin voz"

Spec: `docs/superpowers/specs/2026-10-10-no-speech-gate-robustness-design.md` (aprobada: tramo mínimo 160 ms, factor 2×, gate más permisivo).
Rama: `feat/no-speech-gate-robustness` (desde `main` en `8e926f6`).

## Estado actual relevante

```
handleVoiceLevel(rms) ─► detector.update(rms)            (umbral estricto max(0.008, piso×3), suma muestras sueltas)
finishRecording():  speechSummary = detector.getSummary()  ─► evaluateSpeechGate(summary)  (speechMs ≥ 300)
```

El gate solo ve un número (`speechMs`) y no puede distinguir tramos de voz de picos sueltos, ni usar el ruido de la propia grabación.

## Diseño

**Entrada nueva del gate: el historial de niveles.** El detector guarda `levels[]` y `times[]` (un par por llamada a `update`, unos 25 por segundo) y `getLevels()` devuelve copias. `update()`, `getSummary()` y el auto-stop no cambian.

**Decisión en `speech-gate.cjs` (funciones puras):**

1. `intervalMs` = mediana de las diferencias entre `times` (cadencia real, ~40 ms; 100 ms como respaldo).
2. `noiseFloor` = media más baja en ventanas de 200 ms (`round(200 / intervalMs)` muestras).
3. `threshold = clamp(2 × noiseFloor, 0.005, 0.008)`.
4. Un **tramo** es una racha de muestras consecutivas con nivel ≥ `threshold` y duración (`muestras × intervalMs`) ≥ **160 ms**.
5. `speechMs` = suma de la duración de los tramos. `hasSpeech = speechMs ≥ 300`.
6. Falla abierto: sin historial utilizable (menos de una ventana, valores no numéricos, `levels` y `times` de distinta longitud) devuelve `hasSpeech: true`.

**Refinamiento sobre la spec (lo explico para que lo valides):** la spec decía `max(0.005, 2×piso)` sin techo. Añado el techo **0.008**, el umbral absoluto actual. Así el gate **nunca es más estricto que hoy en nivel**, solo en duración:
- Voz uniforme sin silencio inicial (el límite aceptado nº 6 de la spec): el piso sale alto, pero el techo deja el umbral en 0.008 y el gate se comporta como hoy.
- Voz de 0.010 sobre ruido de 0.004: `2×0.004 = 0.008` y la voz cuenta.
- Ruido estacionario hasta ~0.0075 sigue descartándose (su nivel queda por debajo del umbral).
- Coste: una grabación solo de ruido estacionario por encima de ~0.0075 pasa el gate (se transcribe). Es el comportamiento previo a la puerta y consecuencia directa de la asimetría aprobada.

## Tareas y dependencias

```
T1 historial en el detector ─► T2 funciones del gate ─► T3 corpus ─► T4 renderer ─► T5 script de medición ─► T6 cierre
                                                          │                              │
                                                  checkpoint sintético            checkpoint con tu micrófono
```

## Riesgos

| Riesgo | Mitigación |
|---|---|
| El techo 0.008 deja pasar ruido estacionario fuerte | Aceptado en la spec (error asimétrico); documentado y medido en el corpus |
| La media mínima de 200 ms subestima el piso en grabaciones muy cortas | Falla abierto si no hay al menos una ventana; la grabación mínima ya es de 0,75 s |
| Un tramo de voz real se parte por cierres de consonante (40 ms) y no llega a 160 ms | El corpus ya incluye cierres del 10%; si hay pérdidas se mide y se pregunta antes de tocar el 160 |
| Cambiar la firma de `evaluateSpeechGate` rompe llamadas existentes | Solo la usa `renderer.js`; los tests se reescriben junto con el cambio |
| Memoria del historial en grabaciones largas | ~25 pares/s; 10 minutos son 15 000 pares, despreciable |

## Puntos de control

- Tras T3: criterios del corpus (≥99% pasan / ≥99% se descartan) y cero regresiones.
- Tras T5: tu medición con ruido de fondo; si falla, paro y decidimos antes de seguir.
- Final: `npm test`, `npm run test:production` y revisión de código del diff.
