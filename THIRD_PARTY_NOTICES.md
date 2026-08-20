# Avisos De Software De Terceros

> Identidad anterior: NextStepAI Voice. Los nombres conservados en este documento corresponden a artefactos publicados antes del cambio a felipe avinzano VoiceFlow.

Última actualización: 9 de julio de 2026
Aplicable a: felipe avinzano VoiceFlow `1.1.11` para Windows x64, macOS y Linux

felipe avinzano VoiceFlow incluye, utiliza o descarga componentes de terceros. Cada
componente permanece sujeto a su licencia original. Estos avisos no modifican
ni sustituyen dichas licencias.

Los textos completos de licencia incluidos por los paquetes de runtime se
distribuyen dentro de la aplicación empaquetada. Electron también distribuye:

- `LICENSE.electron.txt`
- `LICENSES.chromium.html`

## Componentes Principales Distribuidos

| Componente | Versión utilizada | Finalidad | Licencia |
|---|---:|---|---|
| Electron | 39.8.10 | Runtime de escritorio para Windows, macOS y Linux | MIT; incluye avisos separados de Chromium y otros componentes |
| Transformers.js (`@huggingface/transformers`) | 3.8.1 | Carga y ejecución local de modelos de IA | Apache License 2.0 |
| ONNX Runtime Node | 1.21.0 | Inferencia nativa local en CPU/DirectML | MIT |
| ONNX Runtime Web | 1.22.0-dev.20250409-89f8206ba4 | Backend requerido por Transformers.js | MIT |
| DirectML | Distribuido con ONNX Runtime Node | Proveedor de ejecución de Windows | MIT |
| electron-updater | 6.8.9 | Comprobación y aplicación de actualizaciones | MIT |
| Sharp | 0.34.5 | Dependencia de procesamiento de imágenes de Transformers.js | Apache License 2.0 |
| Sharp Windows x64 (`@img/sharp-win32-x64`) | 0.34.5 | Binario nativo precompilado | Apache License 2.0 AND LGPL-3.0-or-later |
| Hugging Face Jinja | 0.5.9 | Plantillas utilizadas por Transformers.js | MIT |

Fuentes y licencias:

- Electron: <https://github.com/electron/electron>
- Transformers.js: <https://github.com/huggingface/transformers.js>
- ONNX Runtime: <https://github.com/microsoft/onnxruntime>
- DirectML: <https://github.com/microsoft/DirectML>
- electron-updater: <https://github.com/electron-userland/electron-builder>
- Sharp: <https://github.com/lovell/sharp>
- libvips: <https://github.com/libvips/libvips>
- Hugging Face Jinja: <https://github.com/huggingface/huggingface.js>

## Modelos Descargados Por La Aplicación

Los modelos de voz no forman parte del instalador NSIS. Durante la primera
transcripción de cada perfil, la aplicación descarga los modelos desde Hugging
Face y los almacena en la caché local del usuario.

| Perfil | Repositorio descargado | Modelo base | Licencia declarada por el modelo base |
|---|---|---|---|
| Rápido / Whisper Base | `onnx-community/whisper-base` | `openai/whisper-base` | Apache License 2.0 |
| Máxima precisión / Whisper Large v3 Turbo | `onnx-community/whisper-large-v3-turbo` | `openai/whisper-large-v3-turbo` | Apache License 2.0 |

Los repositorios de ONNX Community identifican los modelos base de OpenAI, pero
no declaran una licencia independiente en sus fichas. Antes de redistribuir los
modelos fuera del flujo de descarga normal, revisa sus fichas y archivos
actuales:

- <https://huggingface.co/onnx-community/whisper-base>
- <https://huggingface.co/onnx-community/whisper-large-v3-turbo>
- <https://huggingface.co/openai/whisper-base>
- <https://huggingface.co/openai/whisper-large-v3-turbo>

## Tipografías Distribuidas

| Tipografía | Finalidad | Licencia |
|---|---|---|
| Geist | Tipografía principal de interfaz | SIL Open Font License 1.1 |
| DM Serif Display | Tipografía editorial de interfaz | SIL Open Font License 1.1 |

Fuentes y licencias:

- Geist: <https://github.com/vercel/geist-font>
- DM Serif Display: <https://github.com/googlefonts/dm-fonts>
- SIL Open Font License 1.1: <https://openfontlicense.org/open-font-license-official-text/>

## Dependencias Transitivas Distribuidas

La aplicación incluye dependencias transitivas necesarias para los componentes
principales. Sus archivos de licencia se conservan dentro del paquete.

### Apache License 2.0

`detect-libc`, `flatbuffers`, `long`.

### BSD 3-Clause

`@protobufjs/aspromise`, `@protobufjs/base64`, `@protobufjs/codegen`,
`@protobufjs/eventemitter`, `@protobufjs/fetch`, `@protobufjs/float`,
`@protobufjs/inquire`, `@protobufjs/path`, `@protobufjs/pool`,
`@protobufjs/utf8`, `global-agent`, `protobufjs`, `roarr`, `sprintf-js`.

### Blue Oak Model License 1.0.0

`chownr`, `minipass`, `sax`, `tar`, `yallist`.

### ISC

`@isaacs/fs-minipass`, `graceful-fs`, `guid-typescript`,
`json-stringify-safe`, `semver`.

### MIT

`@img/colour`, `@types/node`, `boolean`, `builder-util-runtime`, `debug`,
`define-data-property`, `define-properties`, `detect-node`,
`es-define-property`, `es-errors`, `es6-error`, `escape-string-regexp`,
`fs-extra`, `globalthis`, `gopd`, `has-property-descriptors`, `js-yaml`,
`jsonfile`, `lazy-val`, `lodash.escaperegexp`, `lodash.isequal`, `matcher`,
`minizlib`, `ms`, `object-keys`, `platform`, `semver-compare`,
`serialize-error`, `tiny-typed-emitter`, `undici-types`, `universalify`.

### Otras Licencias Permisivas

- `argparse`: Python Software Foundation License 2.0
- `type-fest`: MIT OR CC0-1.0

## Componentes De Compilación No Distribuidos Como Runtime

El proceso de desarrollo y empaquetado utiliza Electron Builder y esbuild,
ambos bajo licencia MIT. Estos componentes no se consideran parte del runtime
principal instalado, aunque puedan participar en la generación del artefacto.

## Microsoft .NET Runtime

El helper autocontenido `FelipeAvinzano.VoiceFlow.PasteHelper.exe` incluye
componentes del runtime Microsoft .NET 8 para Windows x64. .NET Runtime se
distribuye bajo licencia MIT. Consulta:

- <https://github.com/dotnet/runtime>
- <https://github.com/dotnet/runtime/blob/main/LICENSE.TXT>

## Código Fuente Y Solicitudes De Licencia

Los componentes bajo LGPL utilizados por el binario precompilado de Sharp
pueden obtenerse y reconstruirse desde sus proyectos originales:

- Sharp: <https://github.com/lovell/sharp>
- libvips: <https://github.com/libvips/libvips>

Para solicitar una copia de los textos de licencia incluidos con felipe
avinzano VoiceFlow `1.1.11` o reportar una omisión, abre una incidencia en:

<https://github.com/favinzano/VoiceFlow/issues>

## Exclusión De Garantías

El software de terceros se proporciona por sus respectivos titulares bajo los
términos y exclusiones de garantía de sus licencias. Los nombres y marcas de
terceros pertenecen a sus respectivos propietarios.
