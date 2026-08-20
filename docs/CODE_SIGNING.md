# Firma Authenticode Para Windows

> Excepción 1.1.11: Felipe Avinzano autorizó publicar esta versión como `latest` aun con artefactos sin firma y asumió expresamente ese riesgo. La excepción queda limitada a 1.1.11 en `docs/legal-release-approval.json`; las reglas de firma siguientes continúan vigentes para versiones posteriores.

felipe avinzano VoiceFlow usa firma Authenticode con un certificado de firma de codigo `.pfx`, SHA-256 y timestamp RFC 3161.

## Configuracion Del Certificado

El certificado y su contrasena no deben almacenarse dentro del repositorio.

Para beta testers externos se requiere un certificado de firma de codigo
emitido por una autoridad publica confiable o un servicio administrado de firma
para Windows. No distribuyas una CA autofirmada ni solicites a testers que
instalen certificados raiz privados.

Para una compilacion local:

- `SIGNING_PFX_PATH`: ruta absoluta al certificado `.pfx`.
- `SIGNING_PFX_PASSWORD`: contrasena del certificado.
- `SIGNING_TIMESTAMP_URL`: servidor RFC 3161 opcional; por defecto se usa DigiCert.

Para GitHub Actions:

- `SIGNING_PFX_BASE64`: secreto que contiene el `.pfx` codificado en Base64.
- `SIGNING_PFX_PASSWORD`: secreto con la contrasena del certificado.

Configura los secretos sin imprimir su contenido:

```powershell
gh secret set SIGNING_PFX_BASE64 --repo favinzano/VoiceFlow
gh secret set SIGNING_PFX_PASSWORD --repo favinzano/VoiceFlow
```

El workflow `Signed Windows Release` valida que ambos secretos existan antes de
ejecutar pruebas o compilar.

## Construccion Firmada

```powershell
$env:SIGNING_PFX_PATH = "C:\ruta\certificado.pfx"
$env:SIGNING_PFX_PASSWORD = "contrasena"
npm run release:signed
```

El script encuentra el `signtool.exe` x64 del Windows SDK mas reciente. Antes
de compilar valida que el PFX incluya clave privada, declare el uso extendido
Code Signing y no expire durante los siguientes 30 dias. Electron Builder firma
la aplicacion, el helper de pegado, el desinstalador y el instalador usando
SHA-256 y timestamp RFC 3161 antes de generar el blockmap.

En GitHub Actions, ejecuta manualmente el workflow `Signed Windows Release`.
El workflow y el script local se detienen antes de firmar si
`npm run release:verify-acceptance` no aprueba la matriz humana.

## Verificacion Independiente

```powershell
npm run release:verify-signature
```

No publiques un release estable mientras esta comprobacion falle.

## Gate Para Beta Externa

Antes de entregar binarios a testers:

1. Completa `docs/acceptance-results.json` usando la plantilla y evidencia real.
2. Ejecuta `npm run release:verify-acceptance`.
3. Ejecuta manualmente `Signed Windows Release`.
4. Descarga ambos artefactos firmados de GitHub Actions.
5. Ejecuta `Get-AuthenticodeSignature` sobre cada instalador y exige estado
   `Valid`.
6. Publica o reemplaza activos de GitHub Release solo despues de actualizar
   `.sha256`, `.blockmap` y `latest.yml`.

Los releases sin firma deben permanecer marcados como pre-release y no deben
usarse como canal de actualizacion automatica, salvo la excepción explícita y
limitada a una versión registrada por el propietario.
