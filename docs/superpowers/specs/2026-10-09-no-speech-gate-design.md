# Spec: Puerta de "sin voz" (no-speech gate) antes de transcribir

Estado: **aprobada 2026-10-09** (umbral 300 ms; grabaciones sin voz se descartan sin rastro) · Base: v1.2.7 (`main` tras #13) · Roadmap: *P1 Rendimiento y Captura → Detección automática de silencio*

Correcciones tras leer el código para el plan:
- La suposición 4 era errónea: `handleVoiceLevel` sale antes de llamar a `update()` cuando `autoStopEnabled` es false, así que el detector hoy **no** se alimenta con el auto-stop apagado. El plan lo cambia para que el detector siempre reciba el nivel.
- Ya existe un chequeo `peak < 0.002` ("No detectamos voz") en `finishRecording`. El nuevo gate lo complementa; no lo reemplaza.
- El criterio 1 se verifica a nivel de la decisión pura del gate (`speech-gate.test.cjs`) más una comprobación manual en la app, porque `renderer.js` no es testeable en unitario.
- Preguntas 2 y 4 sin respuesta: se usan las propuestas por defecto (aviso en overlay + toast; corpus sintético).

## Hallazgos que motivan la spec

El roadmap pide un VAD local, y gran parte ya existe:

| Requisito del roadmap | Estado en el código |
|---|---|
| VAD con piso de ruido adaptativo | Hecho: `src/voice-activity.cjs` |
| Periodo de gracia configurable | Hecho: ajuste `silenceTimeoutMs` (1800 ms por defecto) |
| Requiere voz antes de considerar una parada | Hecho: `speechDetected` en el detector |
| **No enviar silencio al motor** | **Falta.** `trimEdgeSilence` (`src/audio-quality.cjs`) devuelve el audio completo cuando no encuentra voz, y `renderer.js` lo manda al motor igualmente |
| **Cero transcripciones ante silencio** | **Solo se cumple por el filtro de texto** (`text-cleanup.cjs`) y el test `transcription-smoke.test.cjs`. Cada grabación vacía cuesta una pasada completa de Whisper (~3.6 s con Small) y depende de que el modelo no alucine |
| <1% de cortes prematuros en corpus de pausas | **Sin medir.** No hay corpus ni test |

Esta spec cubre solo las tres filas que faltan.

## Objetivo

Si una grabación no contiene voz, no se llama al motor de transcripción: el usuario recibe un aviso inmediato ("No se detectó voz") y no se pega ni se guarda nada. Hoy esas grabaciones pasan por Whisper y se descartan después por filtrado de texto.

Usuario: quien dicta con atajo (incluido hold-to-talk) y a veces pulsa sin hablar o con ruido de fondo.

## Suposiciones (corrígeme antes de aprobar)

1. El gate vive en el renderer, junto al VAD actual, y decide con el mismo detector (`speechDetected`) en vez de un segundo algoritmo.
2. Se mantiene 100% local y sin dependencias nuevas (regla 1 de `CLAUDE.md`); no se añade un modelo VAD tipo Silero.
3. Una grabación con menos de ~300 ms de voz acumulada cuenta como "sin voz" (evita clics y golpes de teclado). Valor a validar con el corpus.
4. Con el auto-stop desactivado (`autoStopEnabled: false`) el gate sigue aplicando, porque el detector se alimenta igual.
5. Reprocesar una grabación guardada y el flujo hold-to-talk usan el mismo gate.
6. Los umbrales actuales (`speechThreshold` 0.008, `silenceThreshold` 0.004) no cambian en esta spec.

## Tech stack

Electron 39+, Node.js, JS vanilla en `src/renderer.js` (bundle con `esbuild`), módulos `.cjs` con tests `node` + `assert`. Sin dependencias nuevas.

## Comandos

```
Build:        npm run build
Test rápido:  node src/voice-activity.test.cjs && node src/audio-quality.test.cjs
Suite local:  npm test
Producción:   npm run test:production   (incluye el smoke de Whisper real)
```

## Estructura

```
src/voice-activity.cjs        → añadir getSummary() (voz acumulada, speechDetected); sin cambiar update()
src/voice-activity.test.cjs   → tests del resumen
src/speech-gate.cjs           → NUEVO: decide { hasSpeech, speechMs } a partir del resumen del VAD y del audio
src/speech-gate.test.cjs      → NUEVO: tests unitarios + corpus sintético
src/renderer.js               → consultar el gate antes de processAudio / finish; aviso al usuario
package.json                  → registrar speech-gate.test.cjs en `test` y `test:production`
docs/PRODUCT_HARDENING_ROADMAP.md → actualizar estado de la sección
```

`renderer.js` ya es grande; la lógica va en `speech-gate.cjs` y el renderer solo la invoca.

## Estilo de código

Módulos `.cjs` pequeños, funciones puras, sin mutar entradas, opciones con valores por defecto:

```js
function evaluateSpeechGate(summary, options = {}) {
  const minimumSpeechMs = options.minimumSpeechMs ?? 300;
  const speechMs = summary.speechMs;
  return { hasSpeech: summary.speechDetected && speechMs >= minimumSpeechMs, speechMs };
}
```

## Estrategia de pruebas

- **Unitarios** (`speech-gate.test.cjs`, `voice-activity.test.cjs`): silencio puro, ruido estacionario, clic corto, voz de 200 ms (rechaza), voz de 400 ms (acepta), pausa larga a mitad de frase (no corta).
- **Corpus de pausas**: secuencias sintéticas de nivel RMS con pausas de 0.5–1.5 s dentro de una frase; medir cortes prematuros del auto-stop. Meta: <1%.
- **Smoke real** (`transcription-smoke.test.cjs`): se mantiene como red de seguridad del filtro de texto.
- Cobertura objetivo ≥80% en los módulos nuevos.

## Límites

- **Siempre:** correr `npm test` antes de cerrar; mantener `update()` del detector con la misma firma; no registrar audio ni texto en logs.
- **Preguntar antes:** cambiar umbrales por defecto del VAD, añadir un ajuste visible en la UI, añadir cualquier dependencia.
- **Nunca:** llamadas a servicios en la nube, enviar audio fuera del equipo, ampliar `src/main.cjs` (regla 3 de `CLAUDE.md`), borrar tests que fallen sin aprobación.

## Criterios de éxito

1. Una grabación de silencio, ruido estacionario o un clic no invoca al motor (verificado con un doble de prueba que cuenta llamadas) y muestra el aviso "No se detectó voz".
2. Una grabación con ≥300 ms de voz sigue transcribiéndose igual que hoy (sin regresión en `test:production`).
3. Cortes prematuros del auto-stop <1% en el corpus de pausas.
4. `npm test` y `npm run test:production` pasan; no hay llamadas de red nuevas.
5. El roadmap refleja el estado real de la sección.

## Preguntas abiertas

1. ¿El umbral de 300 ms de voz es correcto, o prefieres un valor configurable?
2. Cuando no hay voz, ¿aviso en el overlay únicamente, o también un toast en la ventana principal?
3. ¿Las grabaciones sin voz deben guardarse en el historial como intento fallido, o descartarse sin rastro? (Propuesta: descartarse.)
4. ¿Quieres que el corpus de pausas sea solo sintético o grabar muestras reales tuyas?
