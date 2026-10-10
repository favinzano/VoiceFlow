# Spec: Robustez de la puerta de "sin voz" (dos límites conocidos)

Estado: **borrador, pendiente de aprobación** · Base: `main` en `8e926f6` · Extiende `2026-10-09-no-speech-gate-design.md` (lo no mencionado aquí no cambia: 300 ms mínimos, descarte sin rastro, fallar abierto sin resumen, 100% local, sin dependencias nuevas).

## Los dos problemas

1. **Voz muy baja en sala con ruido constante.** El umbral de voz del detector es `max(0.008, pisoDeRuido × 3)`. Con ruido de ~0.004 RMS (ventilador, calle) el umbral sube a ~0.012; una persona que hable bajo (~0.010) nunca cuenta como voz. El dictado se descarta sin posibilidad de reprocesar y antes sí se transcribía.
2. **`speechMs` suma picos aislados.** Cada muestra sobre el umbral aporta el tiempo desde la anterior. Con muestras cada 40 ms, 8 golpes de teclado, clics o toses sueltos suman 300 ms y pasan el gate.

Los dos tienen la misma raíz: el gate se apoya en un solo criterio (nivel absoluto sobre un umbral) en vez de en la **forma** de la señal. La voz sube y baja y dura; el ruido estacionario es plano; un clic es un pico de una o dos muestras.

## Objetivo

- Una voz baja pero claramente por encima del ruido de la sala pasa el gate aunque no supere el umbral absoluto actual.
- Picos aislados (clic, golpe, tos corta) no suman voz.
- Sin cambiar el comportamiento del auto-stop, que usa los mismos umbrales que hoy.

## Suposiciones (corrígeme antes de aprobar)

1. **Los cambios afectan solo al gate**, no a `update()` ni al auto-stop: sus umbrales (0.008, piso × 3) y el corpus de pausas quedan intactos.
2. **Error asimétrico a propósito:** ante la duda el gate deja pasar. Un falso "hay voz" cuesta una transcripción de ruido, que es lo que pasaba antes de la puerta. Un falso "no hay voz" pierde un dictado. Por eso el criterio nuevo es más permisivo para voz baja y más estricto con picos aislados.
3. **Voz = tramo continuo, no muestra suelta.** Solo cuentan los tramos de al menos **160 ms** (4 muestras de 40 ms) por encima del umbral. Una palabra corta como "sí" (~250 ms) pasa; un golpe de teclado, normalmente ≤2 muestras, no.
4. **Umbral permisivo del gate:** `max(0.005, 2 × pisoDeLaGrabación)`. El piso se estima **de la propia grabación**, como la media más baja en ventanas de 200 ms (5 muestras), en lugar del piso adaptativo del detector. Motivo: ese piso solo se adapta mientras no se detecta voz estricta, así que con voz baja seguiría adaptándose a la propia voz y subiría con ella.
5. **Mínimo absoluto 0.005** (en vez de 0.008) solo para el gate. En tu sala el ruido máximo medido fue 0.0050, cerca del límite: aun así `2 × piso (0.0037) = 0.0074` queda por encima del ruido.
6. **Sin silencio inicial no hay piso fiable.** Si el usuario habla desde la primera muestra, el piso estimado sale alto y el criterio permisivo no ayuda; el gate se comporta como hoy (criterio estricto). Es un límite aceptado.
7. **Se conserva "descarte sin rastro"**: no se guarda `lastAudio` tras un descarte.

## Diseño propuesto

- **`voice-activity.cjs`:** el detector guarda los niveles recibidos (acotados por el tiempo máximo de grabación; unos 25 por segundo) y expone una copia mediante `getLevels()`. `update()` y `getSummary()` no cambian de comportamiento.
- **`speech-gate.cjs`:** nueva función pura `speechRunsMs(levels, intervalsMs, threshold)` que suma solo tramos continuos ≥ 160 ms, y `estimateNoiseFloor(levels)`. `evaluateSpeechGate` pasa a aceptar `{ summary, levels }` y decide con el criterio permisivo; sin niveles utilizables sigue fallando abierto.
- **`renderer.js`:** en `finishRecording` se toma también `getLevels()` antes de liberar la captura (misma línea que el resumen actual).

## Comandos

```
Test rápido: node src/speech-gate.test.cjs && node src/voice-activity.test.cjs && node src/voice-activity-corpus.test.cjs
Suite:       npm test        (y npm run test:production antes del PR)
Medición:    npx electron scripts/measure-voice-levels.cjs
```

## Estrategia de pruebas

- **Voz baja en sala ruidosa (nuevo en el corpus):** ruido 0.004 ± 20% con hablante de 0.010 → hoy se descarta, debe pasar. Ruido solo, sin voz → debe seguir descartándose.
- **Picos aislados (nuevo):** 8, 15 y 30 picos de 1–2 muestras repartidos en una grabación de ruido o de silencio → deben descartarse. Un tramo de voz de 200 ms (5 muestras) → se rechaza por duración total; uno de 400 ms → pasa.
- **Regresión:** todos los casos actuales de `speech-gate.test.cjs`, el corpus de pausas (0 cortes) y las mediciones reales de la sesión (voz normal y baja con el TONOR) siguen pasando.
- **Medición real:** ampliar `measure-voice-levels` con una fase de "voz baja con ruido" (ventilador o audio de fondo) para validar el criterio con tu micrófono, no solo con datos sintéticos.

## Límites

- **Siempre:** `npm test` en verde; fallar abierto; sin dependencias nuevas; sin tocar los umbrales del auto-stop.
- **Preguntar antes:** subir o bajar el mínimo de 300 ms, el tramo de 160 ms, el factor 2× o el mínimo 0.005 una vez fijados; mostrar un ajuste en la UI.
- **Nunca:** nubes, guardar audio, hacer crecer `main.cjs`.

## Criterios de éxito

1. Voz de 0.010 sobre ruido de 0.004 pasa el gate en ≥99% del corpus; el ruido solo se descarta en ≥99%.
2. Con 8 o más picos aislados por grabación, el gate descarta ≥99% de los casos sin voz real.
3. Cero regresiones: corpus de pausas, tests actuales y mediciones reales.
4. Tiempo del gate despreciable (<1 ms para una grabación de 60 s).

## Compromisos que acepto (dímelo si no te sirven)

- En una sala ruidosa, ruido con modulación fuerte (música, conversación ajena) puede pasar el gate y se transcribirá. Es el comportamiento previo a la puerta.
- Sin silencio inicial (hablar pegado al atajo) el criterio permisivo no ayuda.
- La voz que apenas sale del ruido (por debajo de 2× el piso) sigue descartándose.

## Preguntas abiertas

1. ¿Te parece bien dejar al gate **más permisivo** (error asimétrico) a cambio de más transcripciones de ruido en salas ruidosas?
2. ¿Tramo mínimo de 160 ms y factor 2×, o prefieres valores más conservadores (por ejemplo 200 ms y 2.5×)? Sin datos reales de voz baja en ruido, los fijaría con la medición nueva.
3. ¿Quieres que la medición con ruido de fondo la hagas tú con el script ampliado (como antes), o me basta el corpus sintético?
