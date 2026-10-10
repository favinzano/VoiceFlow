# Product Hardening Roadmap

## Objetivo

Convertir felipe avinzano VoiceFlow en una herramienta de dictado para Windows
extremadamente fiable, rápida y verificable, sin ampliar innecesariamente su
alcance.

## Estado Actual

| Área | Estado | Evidencia o siguiente condición |
| --- | --- | --- |
| Firma y release | En progreso | Pipeline SHA-256 y RFC 3161 preparado; falta certificado de producción |
| Auto-Start y bandeja | Implementado | Arranque `--hidden` y pruebas empaquetadas |
| Atajos configurables | Implementado | Registro transaccional con rollback si Windows rechaza un atajo |
| Observabilidad | Implementado | Latencia, factor de tiempo real, memoria RSS y dispositivo efectivo |
| Aceleración | Experimental | DirectML seleccionable con fallback automático a CPU |
| Historial | Implementado | Repositorio JSON versionado, escritura atómica, backup, recuperación, búsqueda y exportación |
| Detección de silencio | Implementado | VAD local adaptativo con voz previa obligatoria y periodo de gracia configurable; una grabación con menos de 300 ms de voz se descarta sin llamar al motor |
| Pegado | Implementado, compilación pendiente | Helper Windows x64 con APIs Win32 directas y fallback explícito a portapapeles |
| Motores | Implementado | Benchmark reproducible de WER, latencia y RTF para los perfiles integrados |
| Validación humana | Gate activo | Matriz de 12 casos obligatoria antes del release firmado |

## P0: Release Confiable

### Firma y distribución

- Firmar instalador y ejecutable con certificado Authenticode de producción.
- Validar instalación limpia, actualización y rollback en Windows 10 y 11.
- Publicar hash SHA-256 y notas de lanzamiento junto al instalador.

**Criterio de salida:** 100% de artefactos verifican firma y hash; actualización
y rollback pasan en dos equipos limpios.

### Matriz humana

- Ejecutar el corpus de aceptación con diferentes acentos, micrófonos y niveles
  de ruido.
- Registrar precisión, latencia total, factor de tiempo real, memoria máxima y
  tasa de pegado.

**Criterio de salida:** cero cierres inesperados en 100 dictados consecutivos y
100% de pegado exitoso en la lista de aplicaciones soportadas.

## P1: Rendimiento y Captura

### Benchmark de motores

El runner `npm run benchmark:models` evalúa Whisper Base, Large v3 Turbo y
candidatos declarados en el manifiesto con el mismo corpus.
No integrar un motor únicamente por velocidad; debe conservar precisión,
licencia compatible, empaquetado reproducible y operación offline.

**Criterio de salida:** el motor rápido debe mantener un factor de tiempo real
menor a `0.5x` en el equipo de referencia y no degradar más de 5% los términos
críticos frente a Base.

### DirectML estable

- Ejecutar pruebas de compatibilidad por GPU y versión de Windows.
- Registrar dispositivo solicitado, dispositivo efectivo y motivo de fallback.
- Mantener CPU como recuperación automática.

**Criterio de salida:** DirectML supera CPU en al menos 25% en hardware
compatible y completa 100 transcripciones sin fuga sostenida de memoria.

### Detección automática de silencio

- VAD local con piso de ruido adaptativo y periodo de gracia configurable.
- Requiere detectar voz antes de considerar una parada.
- No envía silencios iniciales al motor de transcripción.
- Puerta de "sin voz" (`src/speech-gate.cjs`): decide con el historial de niveles
  de la grabación. Solo cuentan los tramos de al menos 160 ms por encima de un
  umbral derivado del ruido de la propia grabación (2 × piso, entre 0.005 y
  0.008); si suman menos de 300 ms, la grabación se descarta sin llamar al
  motor, sin entrada en el historial y con aviso en el overlay. Funciona también
  con el auto-stop apagado.

**Criterio de salida:** cero transcripciones ante silencio y menos de 1% de
cortes prematuros en el corpus de pausas.

**Estado:** el corpus sintético (`src/voice-activity-corpus.test.cjs`, 2000
dictados por perfil de sala, periodo de gracia de 1.8 s) da 0 cortes prematuros.
Es una guardia de regresión: sus pausas máximas (1.68 s) son menores que el
periodo de gracia, así que no sustituye una medición con voz humana real. Con
1.2 s el mismo corpus corta el 12% de los dictados. Los dos límites
conocidos de la primera versión (voz baja sobre ruido constante y picos aislados
que sumaban voz) están resueltos: el corpus del gate
(`src/speech-gate-corpus.test.cjs`) da 100% de voz aceptada, 100% de ruido y de
8/15/30 picos descartados, y la medición con micrófono real pasa las cuatro
fases. Límite aceptado: ruido estacionario por encima de ~0.0075 pasa el gate y
se transcribe (el comportamiento previo a la puerta); un susurro mucho más bajo
que la "voz baja" medida aún puede descartarse. Diseño en
`docs/superpowers/specs/2026-10-09-no-speech-gate-design.md` y
`docs/superpowers/specs/2026-10-10-no-speech-gate-robustness-design.md`.

## P1: Integración Nativa de Windows

El helper Windows x64 reemplaza PowerShell y `SendKeys` y:

- Capture y valide la ventana objetivo.
- Restaure foco sin mostrar consolas.
- Use APIs de entrada de Windows con códigos de error explícitos.
- Detecte aplicaciones elevadas o protegidas y degrade a copia al portapapeles.

**Criterio de salida:** 100% de pegado exitoso en aplicaciones soportadas y
fallback explícito, nunca pérdida silenciosa del texto.

## P2: Persistencia Local Versionada

- Historial, diccionario, micrófono y ajustes viven en un repositorio controlado
  por el proceso principal.
- El esquema versionado implementa migración, escritura atómica y recuperación
  desde copia de seguridad.
- Mantener búsqueda, exportación e importación sin convertir la aplicación en
  una plataforma de notas.

**Criterio de salida:** recuperación comprobada tras escritura interrumpida,
migración de dos versiones anteriores y exportación/importación sin pérdida.

## P2: Producto y Comunidad

- Publicar capturas, página de producto, instalador firmado y guía de privacidad
  verificable.
- Documentar claramente diferencias frente a OpenWhispr sin afirmar afiliación
  ni compatibilidad.
- Definir política de contribuciones coherente con la licencia del producto.

## Definición De 10/10

El producto se considera listo cuando cumple simultáneamente:

- Instalador firmado, actualizable y recuperable.
- 100 dictados consecutivos sin cierre inesperado.
- 100% de pegado o fallback explícito en aplicaciones soportadas.
- Cero transcripciones ante silencio.
- Métricas visibles y reproducibles de latencia, memoria y dispositivo.
- Persistencia recuperable y exportable.
- Operación completamente offline después de descargar el modelo.
