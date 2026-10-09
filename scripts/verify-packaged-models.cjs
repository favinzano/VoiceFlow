const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const brand = require('../src/brand-config.cjs');

const root = path.join(__dirname, "..");
const executable = path.join(root, 'release', 'win-unpacked', `${brand.displayName}.exe`);

function isPathContained(rootPath, candidatePath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function resolveProfiles(argv) {
  const requested = argv.filter((value) => value.startsWith('--profile=')).map((value) => value.slice('--profile='.length));
  const profiles = requested.length ? requested : ['fast', 'accurate'];
  for (const profile of profiles) {
    if (!['fast', 'accurate'].includes(profile)) throw new Error(`Unsupported packaged model profile: ${profile}`);
  }
  return profiles;
}

async function withPackagedSmokeTemp(callback) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), `${brand.slug}-packaged-model-smoke-`));
  try {
    return await callback(userData);
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

async function run() {
  assert.ok(fs.existsSync(executable), "Construye el release antes de probar los modelos empaquetados.");

  return withPackagedSmokeTemp(async (userData) => {
    for (const profileId of resolveProfiles(process.argv.slice(2))) {
      const result = spawnSync(executable, [
        `--self-test-model=${profileId}`,
        `--self-test-user-data=${userData}`,
        // Desde 1.2.3 la app descarga el modelo una vez si falta (ver PRIVACY.md). Aquí se
        // desactiva esa descarga para comprobar que, sin descarga ni paquete offline,
        // el binario empaquetado falla cerrado y no intenta ninguna conexión.
        "--self-test-local-only",
        "--disable-gpu"
      ], {
        encoding: "utf8",
        timeout: 20 * 60 * 1000,
        windowsHide: true
      });
      assert.notEqual(result.status, null, `${profileId}: la autoprueba excedió el tiempo límite`);
      assert.notEqual(result.status, 0, `${profileId}: con la descarga desactivada, una instalación limpia debe fallar cerrada`);
      const diagnostics = `${result.stdout || ""}\n${result.stderr || result.error || ""}`;
      assert.match(
        diagnostics,
        /allowRemoteModels=false|local_files_only=true|paquete del modelo local no est[aá] instalado/i,
        `${profileId}: el fallo no confirmó la política local-only: ${diagnostics}`
      );
      assert.doesNotMatch(diagnostics, /ECONN|ETIMEDOUT|fetch failed|https?:\/\//i, `${profileId}: se observó un intento de red`);
      console.log(`Packaged ${profileId} local-only guard verified`);
    }

    console.log("Packaged model policy verified: with remote downloads disabled, clean installs fail closed until a verified offline pack is installed.");
  });
}

module.exports = { isPathContained, resolveProfiles, withPackagedSmokeTemp };

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
