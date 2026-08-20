# Preparación Para Producción

Estado actual: versión `1.2.2` técnicamente empaquetable para Windows x64, macOS (Apple Silicon e Intel) y Linux x86_64. El propietario autorizó una excepción temporal para su distribución externa mediante `docs/LEGAL_RELEASE_GATE.md`. Los instaladores carecen de firma de un desarrollador identificado (Windows sin Authenticode, macOS sin notarización de Apple); el build de macOS lleva firma ad-hoc para permitir la ejecución en Apple Silicon, pero seguirá mostrando "desarrollador no identificado" hasta notarizarlo. Ver el riesgo correspondiente más abajo.

## Verificado

- Compilación del renderer y comprobación sintáctica del proceso principal.
- Pipeline local con pruebas de limpieza, muletillas, espacios, emails, URLs y estructura.
- Whisper Base y Whisper Large v3 Turbo cargados y probados localmente.
- Filtrado de salidas no verbales y alucinaciones breves conocidas.
- Captura mediante atajo global, overlay sin robo de foco y pegado en la aplicación activa.
- Procesamiento, diccionario e historial locales.
- Icono e identidad visual propios.
- Auditoría de dependencias de producción sin vulnerabilidades de severidad alta o crítica (ver vulnerabilidad moderada conocida y sin corrección en Problemas Conocidos).
- Instalador NSIS reproducible, instalación, arranque y desinstalación validados.
- Ejecutable empaquetado validado con Whisper Base y Whisper Large v3 Turbo.
- Caché de modelos persistente en datos del usuario y acción de reparación.
- Checksum SHA-256 generado automáticamente.
- Borradores bilingües de Política de privacidad y Términos, licencia y avisos de terceros incluidos; pendientes de aprobación jurídica para publicación.
- Estrategia de actualización manual y rollback documentada.
- CI independiente de Windows, macOS y Linux para validar, ejecutar la autoprueba empaquetada y construir artefactos con sus módulos nativos.
- Perfil de desarrollo aislado del perfil instalado y limpieza única del historial prerelease.
- Cierre a bandeja con elección recordada, configuración visible y prueba empaquetada.
- Workflow de firma pública que bloquea artefactos Authenticode inválidos.

## Bloqueadores Antes Del Lanzamiento Estable

1. Aprobar completamente `docs/LEGAL_RELEASE_GATE.md`: buzón comercial, URLs HTTPS, email operativo, revisión jurídica escrita, aceptación, borrado y auditoría de red archivada.
2. Firmar el ejecutable e instalador de Windows con un certificado de firma de código para reducir alertas de SmartScreen, y notarizar el `.dmg` de macOS para evitar el bloqueo de Gatekeeper.
3. Ejecutar pruebas de aceptación con grabaciones reales:
   - Diferentes voces, acentos, micrófonos y niveles de ruido.
   - Dictados cortos y largos.
   - Emails, URLs, nombres propios y términos técnicos.
   - Medición de precisión, latencia y tasa de pegado exitoso.
4. Completar la matriz física mínima: Windows 10/11, macOS Apple Silicon/Intel y Linux X11/Wayland, incluyendo equipos con poca memoria y CPU más lenta.
5. Validar instalación sobre una versión anterior y rollback cuando exista un segundo instalador versionado.

## Problemas Conocidos

- **El smoke completo de Whisper en `Windows Release Check` es informativo** porque los runners de Windows de GitHub bloquean de forma intermitente los archivos ONNX recién descargados (`system error number 13`), incluso después de reintentos y cachés nuevas. La causa relacionada está documentada en `@huggingface/transformers` ([issue #1279](https://github.com/huggingface/transformers.js/issues/1279)). Windows conserva como requisitos bloqueantes la suite de producción, un modelo ONNX mínimo ejecutado con el binding nativo real, la inspección de los bindings empaquetados, el helper nativo y las autopruebas del instalador. Los smoke completos de Whisper siguen siendo bloqueantes en macOS y Linux; por tanto, una advertencia Windows sólo es aceptable si ambos pasan y el smoke ONNX Windows queda verde.

- **`npm audit --omit=dev` reporta 7 vulnerabilidades moderadas heredadas de `@nut-tree-fork/nut-js@4.2.6`** (la última versión publicada) a través de su dependencia fijada a una versión exacta `jimp@0.22.10` → `file-type` ([GHSA-5v7r-6r5c-r473](https://github.com/advisories/GHSA-5v7r-6r5c-r473): bucle infinito en el parser ASF con entrada malformada). No existe todavía una versión corregida («No fix available» según `npm audit`), y como `nut-js` fija `jimp` a una versión exacta, no se puede resolver actualizando ni con `npm audit fix`. Esta aplicación solo usa la API `keyboard` de `nut-js` (ver `src/input-helper.cjs`); la ruta vulnerable (procesamiento de imágenes/captura de pantalla) nunca se invoca. Mitigación actual: el paso de auditoría en CI usa `--audit-level=critical` para no bloquear en este hallazgo moderado y documentado, sin dejar de fallar ante vulnerabilidades altas o críticas futuras. Revisar cuando `file-type` o `@jimp/core` publiquen una versión corregida.

## Comandos De Validación

```powershell
npm test
npm run test:production
npm run test:models
npm run release:win
npm run release:verify
npm run release:test-models
npm run release:test-installer
npm run release:test-tray
npm run release:verify-signature
npm audit --omit=dev --audit-level=critical
```

`npm run test:models` descarga y valida Whisper Base y Whisper Large v3 Turbo, por lo que requiere conexión en su primera ejecución.
