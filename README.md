# felipe avinzano VoiceFlow

> **Excepción temporal para 1.2.5:** el propietario autorizó expresamente el lanzamiento público de esta versión y asumió los requisitos externos todavía pendientes. Esta excepción no equivale a aprobación jurídica y no se aplica a versiones posteriores; consulta `docs/LEGAL_RELEASE_GATE.md`.

Aplicación de escritorio multiplataforma (Windows, macOS y Linux) para convertir voz en texto con Whisper ejecutado localmente. VoiceFlow no envía el audio ni las transcripciones: no hay cuentas, autenticación, telemetría ni servicios de IA en la nube. La aplicación sí usa red para descargar modelos desde Hugging Face, comprobar actualizaciones en GitHub y abrir soporte cuando el usuario lo solicita.

## Instalación

Los instaladores de cada versión están en [Releases](https://github.com/favinzano/VoiceFlow/releases/latest):

| Plataforma | Instalador | Notas |
|---|---|---|
| Windows x64 | `felipe-avinzanovoiceflow-Setup-1.2.5-AVX2-x64.exe` | Recomendado en CPUs modernas (2013+). Único con actualización automática. |
| Windows x64 (Legacy) | `felipe-avinzanovoiceflow-Setup-1.2.5-Legacy-x64.exe` | Para CPUs sin soporte AVX2. Descarga manual, sin auto-actualización. |
| macOS (Apple Silicon) | `felipe-avinzanovoiceflow-Setup-1.2.5-arm64.dmg` | Build nativo arm64. |
| macOS (Intel) | `felipe-avinzanovoiceflow-Setup-1.2.5-x64.dmg` | Build nativo x64. |
| Linux x86_64 | `felipe-avinzanovoiceflow-Setup-1.2.5-x86_64.AppImage` | Ejecutable portable, no requiere instalación. |

Ninguno de los instaladores tiene firma de código de un desarrollador identificado (Windows sin Authenticode, macOS sin notarización de Apple). El build de macOS sí lleva una **firma ad-hoc**, necesaria para que los binarios Apple Silicon (arm64) puedan ejecutarse:

- **Windows** mostrará la advertencia de SmartScreen "editor desconocido" — usa "Más información" → "Ejecutar de todas formas".
- **macOS** mostrará "desarrollador no identificado" la primera vez — arrastra la app a Aplicaciones y ábrela con **clic derecho → Abrir** (o Ajustes del Sistema → Privacidad y seguridad → "Abrir de todos modos"). Si un `.dmg` antiguo sin firmar diera el error "está dañado", quítale la cuarentena con `xattr -cr "/Applications/felipe avinzano VoiceFlow.app"`.

El archivo `Iniciar felipe avinzano VoiceFlow.bat` se mantiene únicamente para desarrollo local en Windows.

## Funciones

- Grabación desde el micrófono, con parada automática mediante VAD local adaptativo.
- Dos perfiles de calidad: Whisper Base (velocidad) y Whisper Large v3 Turbo (máxima precisión).
- Cinco idiomas de transcripción: español, inglés, francés, alemán y portugués.
- Inferencia por CPU o DirectML experimental en Windows, con recuperación automática a CPU.
- Atajos globales configurables, en dos modos: alternar (inicia/detiene con cada pulsación) o mantener presionado (solo Windows).
- Inicio automático nativo al iniciar sesión en Windows, macOS y Linux.
- Pegado automático en la app activa o copia al portapapeles, con reintento y aviso explícito si el pegado falla.
- Limpieza opcional del texto transcrito y diccionario personal de reemplazos.
- Historial local configurable, buscable y exportable.
- Métricas locales de latencia, factor de tiempo real y memoria utilizada.
- Persistencia versionada con backup y recuperación local.
- Guía rápida, diagnóstico copiable (sin transcripciones) y preferencias avanzadas.
- Burbuja flotante que no roba el foco al usar el atajo global.
- Actualización automática vía GitHub Releases (Windows, canal AVX2).

## Ejecutar desde el código fuente

```powershell
npm install
npm run build
npm start
```

La primera transcripción de cada modo descarga su modelo Whisper. Después queda almacenado en la caché local y la inferencia se realiza en el equipo. Al cambiar de modo, la aplicación libera el modelo anterior de la memoria.

Si una descarga queda incompleta o dañada, abre `Soporte` y selecciona `Reparar modelos`.

Antes de dar por cerrado un cambio, corre `npm test`. Antes de distribuir una beta externa, la puerta `docs/LEGAL_RELEASE_GATE.md` debe estar aprobada y acompañada por la evidencia indicada.

## Estado de producción

La versión `1.2.5` es la versión actual para Windows x64. La misma versión de código se empaqueta para macOS y Linux. Consulta `PRODUCTION_READINESS.md` y `docs/RELEASE_CHECKLIST.md` antes de publicar un instalador.

## Soporte

Reporta incidencias en `https://github.com/favinzano/VoiceFlow/issues`. Los diagnósticos copiados desde la aplicación no incluyen transcripciones.
