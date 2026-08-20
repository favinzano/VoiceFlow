## - 2026-06-14

- **Added:** New native Windows Taskbar status overlays and binary badge tracking for downloading, recording, and inference states. Dual-mode hotkey settings layout supporting toggle and low-level "Push-to-Talk" hardware events.
- **Optimized (DevOps Overhaul):** Matrix compilation build pipeline splits inside GitHub Actions for `Legacy` vs `AVX2` binaries. Integrated pre-release native DLL extraction compression routines using UPX binary stripping tools.
# Changelog

> Identidad anterior: NextStepAI Voice. Los nombres conservados en este documento corresponden a artefactos publicados antes del cambio a felipe avinzano VoiceFlow.

Todos los cambios relevantes de felipe avinzano VoiceFlow se documentan en este archivo.

## [1.2.3] - 2026-08-20

### Corregido

- Corregida la provisión del modelo en instalaciones nuevas: desde 1.1.10 la descarga del modelo estaba desactivada (`allowRemoteModels: false`) y, como el modelo no se empaqueta en el instalador, una máquina limpia (p. ej. un Mac recién instalado) no podía transcribir ("El paquete del modelo local no está instalado o está incompleto"). Se restaura la descarga **local-first**: transformers.js usa el modelo ya cacheado y solo lo descarga una vez, desde Hugging Face, cuando falta. El audio del usuario sigue sin salir del equipo.
- Corregida la etiqueta del atajo en macOS: la interfaz mostraba "Ctrl + Shift + Espacio" en textos estáticos aunque en Mac el atajo real es ⌘. Ahora la etiqueta principal y el estado inicial muestran "Cmd" en macOS.

## [1.2.2] - 2026-08-19

### Corregido

- Corregido el error "está dañado y no puede abrirse" del `.app` de macOS en Apple Silicon (arm64). El build salía sin ninguna firma, y macOS exige al menos una firma para ejecutar binarios arm64. Ahora electron-builder aplica una **firma ad-hoc** (`mac.identity: "-"`) a los bundles arm64 y x64. La app deja de reportarse como dañada; en la primera apertura mostrará el aviso normal de "desarrollador no identificado" (clic derecho → Abrir), ya que sigue sin estar notarizada por Apple.

## [1.2.1] - 2026-07-22

### Corregido

- Corregida la regresión de velocidad de 1.2.0: el motor whisper.cpp resultó más lento en CPU que el motor residente transformers.js/onnxruntime, porque recargaba el modelo en cada dictado mientras onnxruntime lo mantiene en memoria. Se retira whisper.cpp y el motor local vuelve a transformers.js. Una migración única devuelve a los usuarios al motor anterior.

### Cambiado

- El perfil por defecto ("Balanceado") ahora usa **Whisper Small** en lugar de Large v3 Turbo: mucho más rápido en CPU (~3.6s en caliente vs ~11s) manteniendo buena calidad y 100% local. "Rápido" sigue en Whisper Base y "Máxima precisión" en Large v3 Turbo.

## [1.2.0] - 2026-07-21

### Añadido

- Nuevo motor de transcripción **whisper.cpp** (CPU) como motor local por defecto: ejecuta Whisper Large v3 Turbo mediante un binario nativo (sidecar) en lugar de transformers.js/onnxruntime, con una mejora sustancial de velocidad manteniendo el 100% local. El binario oficial de `ggml-org/whisper.cpp` se descarga y verifica por SHA-256 en build (Windows y Linux); los modelos GGML se descargan bajo demanda y se cachean localmente.
- Migración única que activa whisper.cpp para los usuarios existentes.

### Cambiado

- El motor transformers.js/onnxruntime pasa a ser un respaldo automático: si el binario de whisper.cpp no está presente o falla al iniciar, la transcripción recae en él de forma transparente. En macOS se usa el respaldo (sin binario propio en esta versión).

## [1.1.13] - 2026-07-20

### Corregido

- Revertida la aceleración DirectML como valor por defecto: la ruta experimental de GPU producía transcripciones corruptas (texto ilegible y repetido). El motor vuelve a CPU, estable, y DirectML queda disponible solo como opción avanzada opt-in.
- Migración correctiva única que devuelve a CPU a los usuarios que la versión anterior había forzado a DirectML.
- Corregido el desbordamiento horizontal de la ventana con transcripciones muy largas (ajuste de línea en el historial).

## [1.1.12] - 2026-07-20

### Cambiado

- Rediseñado el lockup de marca "VoiceFlow" como firma dual-font consistente en la página de inicio y el overlay: isotipo SVG "La Incisión" + "Voice" en Geist y "Flow" en DM Serif Display copper, con sistema de proporciones basado en X (altura del isotipo) y clear space definido por contexto.
- Retirado el respaldo "felipe avinzano" del encabezado del overlay; el lockup maestro en ambas superficies es únicamente "VoiceFlow".
- Reconciliado el color Copper de marca a `#B87333` (valor canónico del brief) en toda la interfaz, configuración y documentación de diseño.

## [1.1.11] - 2026-07-17

### Corregido

- Restaurado el arranque interactivo del renderer: los botones legales de la pantalla inicial ahora están vinculados antes de registrar sus eventos.
- Añadida una autoprueba que carga la interfaz real y bloquea futuros releases ante errores de JavaScript o inicialización incompleta.

## [1.1.10] - 2026-07-17

### Corregido

- Igualada la experiencia de inicio automático, atajos, pegado y puente de escritorio entre Windows, macOS y Linux.
- Endurecida la transcripción offline para impedir fallbacks de modelos empaquetados hacia ubicaciones remotas.

### Añadido

- Validación de paquetes nativos, modelos locales y autopruebas del puente de escritorio en las tres plataformas.
- Matrices de release deterministas para Windows Legacy/AVX2, macOS arm64/x64 y Linux x64.

### Publicación

- Registrada la excepción temporal del propietario para publicar 1.1.10 como `latest` con requisitos legales, operativos y de firma aún pendientes.

## [1.1.9] - 2026-07-11

### Corregido

- El overlay de dictado ya no queda oculto detrás de aplicaciones en pantalla
  completa o maximizadas, tanto en Windows (reafirmación de `alwaysOnTop` en
  cada actualización de estado) como en macOS (soporte de `visibleOnFullScreen`
  para Espacios en pantalla completa).
- El pegado automático ya no reduce el tamaño de una ventana de destino
  maximizada: se eliminó una llamada incondicional a `SW_RESTORE` en el helper
  nativo de pegado.
- Sustituidas dos esperas bloqueantes del helper nativo de pegado por un bucle
  de bombeo de mensajes, evitando que Windows marque la ventana de destino
  como "No responde" mientras el helper mantiene el foco adjunto.

### Añadido

- Build nativo de macOS para Intel (x64), junto al ya existente de Apple
  Silicon (arm64).

### Optimizado

- El modelo de transcripción Whisper ahora se precarga en segundo plano al
  iniciar la aplicación, en vez de cargarse por completo en el primer dictado.

### Documentación

- Corregidas referencias desactualizadas de versión, marca y modelo en
  `PRODUCTION_READINESS.md`, `THIRD_PARTY_NOTICES.md` y
  `docs/RELEASE_CHECKLIST.md`.

## [1.1.3] - 2026-07-04

### Corregido

- Restaurado el atajo global `Ctrl+Shift+Space` mediante listeners nativos no
  exclusivos, incluso si otra aplicación reservó la misma combinación, y una
  autoprueba sobre la aplicación instalada.
- Restaurado el pegado en el control que tenía el foco al iniciar el dictado,
  mediante captura y recuperación nativas del foco de Windows.
- Sustituidas las ondas decorativas y aleatorias por nueve niveles derivados
  del audio real, suavizados y compartidos por la interfaz principal y el
  overlay flotante.
- Aumentada la legibilidad y restauradas las esquinas redondeadas del overlay.

## [1.1.2] - 2026-07-04

### Corregido

- Corregida la carga del puente de escritorio en los preloads sandboxed de Electron.
- Añadida una verificación del puente sobre el ejecutable instalado.
- Restaurado DM Serif Display en el acento aprobado «siguiente paso».

## [1.1.1] - 2026-06-14

### Corregido

- Restaurada la visualización del overlay inferior durante grabaciones iniciadas
  desde el botón de la aplicación, además de las iniciadas mediante el atajo
  global.
- Sincronizados los estados de grabación, procesamiento, éxito y error del
  overlay para todos los métodos de captura.
- Ajustadas las instrucciones del overlay según el origen de la grabación:
  botón, atajo Toggle o Push-to-Talk.

## [1.1.0] - 2026-06-14

### Añadido

- Nuevos indicadores nativos de estado en la barra de tareas de Windows para
  descarga, grabación y procesamiento.
- Configuración de atajos en modos Toggle y Push-to-Talk mediante eventos
  nativos de bajo nivel.

### Optimizado

- Pipeline matricial de GitHub Actions para instaladores Legacy y AVX2.
- Compresión previa al empaquetado de DLL nativas mediante UPX.

## [1.0.0] - 2026-06-14

Primer lanzamiento candidato para Windows x64.

### AÃ±adido

- Dictado local mediante Whisper Base y Whisper Large v3 Turbo.
- Captura PCM sin compresiÃ³n mediante AudioWorklet, sin la pÃ©rdida introducida
  por MediaRecorder/Opus.
- Perfil MÃ¡xima PrecisiÃ³n con Large v3 Turbo Q8 y beam search.
- Atajo global `Ctrl+Shift+Space` para iniciar o detener una grabaciÃ³n.
- Atajo `Ctrl+Alt+Space` para reprocesar la Ãºltima grabaciÃ³n.
- Pegado automÃ¡tico, overlay flotante, historial local, formato hablado y
  diccionario personal.
- IntegraciÃ³n con la bandeja del sistema y cierre en segundo plano.
- Auto-Start nativo de Windows, con arranque silencioso mediante `--hidden`.
- Ajuste **Iniciar con Windows** para controlar el Auto-Start desde la interfaz.
- ConfiguraciÃ³n inicial que habilita Auto-Start en el primer lanzamiento
  empaquetado.
- Atajos globales configurables con rollback si Windows rechaza el cambio.
- OpciÃ³n experimental DirectML con fallback automÃ¡tico a CPU.
- MÃ©tricas visibles de latencia, factor de tiempo real y memoria.
- BÃºsqueda y exportaciÃ³n JSON del historial local.
- VAD local adaptativo con parada automÃ¡tica y periodo de gracia configurable.
- Persistencia JSON versionada fuera de `localStorage`, con escritura atÃ³mica,
  backup y recuperaciÃ³n.
- Helper Windows x64 autocontenido para captura de foco y pegado mediante APIs
  Win32 directas.
- Benchmark reproducible de modelos con WER, latencia y factor de tiempo real.
- Gate obligatorio de doce casos humanos antes del release firmado.

### Cambiado

- Arquitectura enfocada en dictado local y privado para Windows x64, informada
  por una revisiÃ³n competitiva frente a OpenWhispr.
- Empaquetado reducido a los binarios ONNX Runtime requeridos para Windows x64.
- Binarios nativos `.dll` y `.node` de ONNX Runtime desempaquetados del archivo
  ASAR para permitir su carga correcta.
- CachÃ© persistente de modelos alojada en `userData` para reutilizaciÃ³n offline.
- Inferencia de pruebas forzada a CPU y FP32 para ejecuciÃ³n predecible en CI.

### Privacidad y seguridad

- Audio, modelos, historial, preferencias y transcripciones permanecen locales.
- No se requieren cuentas, telemetrÃ­a ni servicios de transcripciÃ³n en la nube.
- ExclusiÃ³n de cachÃ©s de Hugging Face y modelos `.onnx` del instalador.
- Pipeline de firma preparado para SignTool con SHA-256 y timestamp RFC 3161.

### CompilaciÃ³n y lanzamiento

- ExclusiÃ³n de binarios ONNX Runtime para ARM64, Linux y macOS.
- ConservaciÃ³n de binarios Windows x64 necesarios para CPU y DirectML.
- VerificaciÃ³n del paquete para detectar arquitecturas no deseadas, binarios
  faltantes y modelos filtrados.
- Instalador NSIS x64 con nombre
  `NextStepAI-Voice-Setup-1.0.0-x64.exe`.

### Pruebas y QA

- Pruebas de humo de modelos con cachÃ© temporal aislada.
- VerificaciÃ³n del tamaÃ±o e integridad de archivos ONNX descargados.
- Pruebas del arranque oculto a la bandeja y del comportamiento de cierre.
- Checklist de cold start, persistencia offline y liberaciÃ³n de memoria.

### ComparaciÃ³n con OpenWhispr

- NextStepAI Voice mantiene una implementaciÃ³n independiente y especializada en
  Windows x64.
- Se prioriza una superficie de producto mÃ¡s pequeÃ±a: dictado local, operaciÃ³n
  offline, Auto-Start silencioso y paquete optimizado.
- OpenWhispr conserva un alcance mÃ¡s amplio y multiplataforma; no existe
  afiliaciÃ³n, dependencia de cÃ³digo ni compatibilidad implÃ­cita entre ambos
  proyectos.

### Limitaciones conocidas

- La inferencia de v1.0.0 se ejecuta en CPU, aunque el paquete conserva los
  binarios DirectML para trabajo futuro.
- El primer uso de cada modelo requiere una descarga desde la red.
- La publicaciÃ³n estable requiere firma con el certificado de producciÃ³n,
  aceptaciÃ³n humana en hardware adicional y validaciÃ³n de actualizaciÃ³n y
  rollback.
