'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const brand = require('../src/brand-config.cjs');
const packageJson = require('../package.json');
const { normalizeAsarPath, resolveReleasePaths } = require('./verify-release.cjs');
const { spawnSync } = require('node:child_process');

const packagedSmokePrefix = `${brand.slug}-packaged-model-smoke-`;
const listPackagedSmokeDirs = () => fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith(packagedSmokePrefix)).sort();
const smokeDirsBeforeImport = listPackagedSmokeDirs();
const { isPathContained, resolveProfiles } = require('./verify-packaged-models.cjs');
assert.deepEqual(listPackagedSmokeDirs(), smokeDirsBeforeImport, 'importing packaged model helpers must not allocate temp storage');
const lifecycleTest = spawnSync(process.execPath, [path.join(__dirname, 'verify-packaged-models-lifecycle.test.cjs')], { encoding: 'utf8' });
assert.equal(lifecycleTest.status, 0, lifecycleTest.stderr);

assert.equal(fs.readFileSync(path.join(root, 'package.json'), 'utf8')[0], '{', 'package.json must not contain a UTF-8 BOM');
assert.equal(normalizeAsarPath('\\src\\brand-config.json'), 'src/brand-config.json');
const containmentRoot = path.join(os.tmpdir(), 'smoke');
assert.equal(isPathContained(containmentRoot, path.join(containmentRoot, 'userData', 'models')), true);
assert.equal(isPathContained(containmentRoot, path.join(os.tmpdir(), 'AppData', 'models')), false);
assert.deepEqual(resolveProfiles(['--profile=fast']), ['fast']);
assert.deepEqual(resolveProfiles([]), ['fast', 'accurate']);
assert.throws(() => resolveProfiles(['--profile=turbo']), /Unsupported packaged model profile/);

const standard = resolveReleasePaths({ root, version: packageJson.version });
assert.equal(path.basename(standard.installerPath), brand.installerName(packageJson.version));
assert.equal(path.basename(standard.unpackedExe), `${brand.displayName}.exe`);
assert.equal(path.basename(standard.pasteHelper), brand.helperExecutable);

const avx2 = resolveReleasePaths({ root, version: packageJson.version, releaseFlavor: 'AVX2' });
assert.equal(path.basename(avx2.installerPath), brand.installerName(packageJson.version, 'AVX2'));
assert.throws(
  () => resolveReleasePaths({ root, version: packageJson.version, releaseFlavor: 'SSE2' }),
  /Unsupported RELEASE_FLAVOR: SSE2/,
);

const nodeScripts = [
  'verify-release.cjs',
  'verify-packaged-models.cjs',
  'verify-packaged-platform.cjs',
  'generate-release-notes.cjs',
];
for (const name of nodeScripts) {
  const source = fs.readFileSync(path.join(__dirname, name), 'utf8');
  assert.match(source, /require\(['"]\.\.\/src\/brand-config\.cjs['"]\)/, `${name} must load canonical brand config`);
}

const powershellScripts = [
  'release-signed.ps1',
  'verify-signature.ps1',
  'test-installer.ps1',
  'test-tray.ps1',
  'release-1.1.0.ps1',
];
for (const name of powershellScripts) {
  const source = fs.readFileSync(path.join(__dirname, name), 'utf8');
  assert.match(source, /brand-config\.json/, `${name} must load canonical brand config`);
  assert.match(source, /ConvertFrom-Json/, `${name} must parse canonical brand config`);
  if (process.platform === 'win32') {
    const escapedPath = path.join(__dirname, name).replace(/'/g, "''");
    const parse = spawnSync('powershell', ['-NoProfile', '-Command', `$t=$null;$e=$null;[Management.Automation.Language.Parser]::ParseFile('${escapedPath}',[ref]$t,[ref]$e)|Out-Null;if($e.Count){$e|ForEach-Object{Write-Error $_};exit 1}`], { encoding: 'utf8' });
    assert.equal(parse.status, 0, `${name} PowerShell parse failed: ${parse.stderr}`);
  }
}

const activeScripts = fs.readdirSync(__dirname)
  .filter((name) => /\.(?:cjs|ps1)$/.test(name) && !['release-brand.test.cjs', 'verify-brand-references.cjs', 'verify-brand-references.test.cjs'].includes(name));
const forbidden = /NEXTSTEPAI|NextStepAI Voice|NextStepAI\.PasteHelper|nextstepai-voice|NextStepAI-Voice-Setup/i;
for (const name of activeScripts) {
  const source = fs.readFileSync(path.join(__dirname, name), 'utf8');
  assert.doesNotMatch(source, forbidden, `${name} contains an active legacy product identifier`);
}

assert.equal(packageJson.build.win.artifactName, `${brand.slug}-Setup-\${version}-\${arch}.\${ext}`);
assert.equal(packageJson.build.publish[0].owner, brand.repository.owner);
assert.equal(packageJson.build.publish[0].repo, brand.repository.name);
assert.deepEqual(packageJson.build.win.extraResources[0].filter, [brand.helperExecutable]);

const workflow = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8');
assert.doesNotMatch(workflow, forbidden, 'release workflow contains a legacy product identifier');
assert.match(workflow, new RegExp(brand.slug, 'i'));
assert.match(workflow, new RegExp(brand.displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
assert.match(workflow, new RegExp(brand.repository.slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

const signedWorkflow = fs.readFileSync(path.join(root, '.github/workflows/signed-release.yml'), 'utf8');
assert.match(
  signedWorkflow,
  /powershell\s+-NoProfile\s+-ExecutionPolicy\s+Bypass\s+-File\s+scripts\/verify-signature\.ps1\s+-ReleaseFlavor\s+["']?\$\{\{\s*matrix\.flavor\s*\}\}["']?/,
  'signed workflow passes every matrix flavor explicitly to independent signature verification',
);
const windowsCheckWorkflow = fs.readFileSync(path.join(root, '.github/workflows/windows-release-check.yml'), 'utf8');
assert.match(windowsCheckWorkflow, /Verify Windows ONNX Runtime native binding[\s\S]*?npm run test:onnx-runtime/, 'Windows blocks on a deterministic native ONNX smoke test');
assert.match(windowsCheckWorkflow, /Run full Whisper smoke \(known upstream Windows runner flake\)[\s\S]*?continue-on-error:\s*true[\s\S]*?npm run test:models/, 'only the documented full Windows Whisper smoke is non-blocking');
for (const [source, name] of [[signedWorkflow, 'signed release workflow'], [windowsCheckWorkflow, 'Windows release check workflow']]) {
  assert.doesNotMatch(source, forbidden, `${name} contains a legacy product identifier`);
  assert.match(source, /src\/brand-config\.json/, `${name} loads the canonical brand config`);
  assert.match(source, /PRODUCT_SLUG/, `${name} exports the canonical slug`);
  assert.match(source, /PRODUCT_DISPLAY_NAME/, `${name} exports the canonical display name`);
  assert.match(source, /HELPER_EXECUTABLE/, `${name} exports the canonical helper executable`);
  assert.match(source, /\$\{\{\s*env\.PRODUCT_SLUG\s*\}\}/, `${name} derives artifact patterns from the canonical slug`);
}

const platformWorkflows = [
  [workflow, 'multiplatform release workflow', ['win32', 'darwin', 'linux']],
  [windowsCheckWorkflow, 'Windows release check workflow', ['win32']],
  [fs.readFileSync(path.join(root, '.github/workflows/macos-release-check.yml'), 'utf8'), 'macOS release check workflow', ['darwin']],
  [fs.readFileSync(path.join(root, '.github/workflows/linux-release-check.yml'), 'utf8'), 'Linux release check workflow', ['linux']]
];
for (const [source, name, platforms] of platformWorkflows) {
  assert.match(source, /verify-packaged-platform\.cjs/, `${name} verifies packaged native bindings`);
  for (const platform of platforms) {
    assert.match(source, new RegExp(`--platform=${platform}`), `${name} verifies ${platform}`);
  }
  if (platforms.includes('darwin') || platforms.includes('linux')) {
    assert.match(source, /--self-test-desktop-bridge/, `${name} runs the packaged desktop bridge self-test`);
  }
}

const trayTest = fs.readFileSync(path.join(__dirname, 'test-tray.ps1'), 'utf8');
assert.equal((trayTest.match(/--test-user-data=`"\$/g) || []).length, 2, 'both tray launches quote explicit isolated app roots');
assert.doesNotMatch(trayTest, /--user-data-dir|\$env:APPDATA/i, 'tray QA cannot fall back to Chromium-only or live AppData paths');
assert.match(trayTest, /Join-Path \$hiddenProfile ["']userData["']/);
assert.match(trayTest, /Join-Path \$profile ["']userData["']/);
assert.match(trayTest, /taskkill\.exe \/PID \$process\.Id \/T \/F/, 'tray cleanup terminates only the launched Electron process tree');
assert.match(trayTest, /throw ["']Tray QA failed to clean isolated root:/, 'tray cleanup fails when an isolated root cannot be removed');
assert.match(trayTest, /\$hiddenProcess\s*=\s*\$null[\s\S]*?try\s*\{[\s\S]*?Start-Process[\s\S]*?finally\s*\{[\s\S]*?Stop-TestProcessTree \$hiddenProcess[\s\S]*?Remove-TestRoot \$hiddenProfile/, 'hidden tray cleanup covers setup and launch failures');
assert.match(trayTest, /\$process\s*=\s*\$null[\s\S]*?try\s*\{[\s\S]*?Start-Process[\s\S]*?finally\s*\{[\s\S]*?Stop-TestProcessTree \$process[\s\S]*?Remove-TestRoot \$profile/, 'visible tray cleanup covers setup and launch failures');
const installerTest = fs.readFileSync(path.join(__dirname, 'test-installer.ps1'), 'utf8');
assert.equal(packageJson.build.nsis.deleteAppDataOnUninstall, false, 'NSIS contract must preserve canonical Electron AppData on uninstall');
assert.match(installerTest, /--test-user-data=`"\$isolatedRoot`"/, 'installer QA launches with a quoted explicit isolated app root');
assert.match(installerTest, /--self-test-desktop-bridge/, 'installer QA exercises the sandboxed desktop bridge');
assert.match(installerTest, /--self-test-user-data=`"\$isolatedRoot`"/, 'installer bridge QA uses an isolated app root');
assert.match(installerTest, /-ArgumentList @\(\s*["']\/S["']\s*,\s*\(["']\/D=["'] \+ \$target\)\s*\)/, 'NSIS custom directory remains the final structured argument so paths with spaces are consumed correctly');
assert.doesNotMatch(installerTest, /\$env:APPDATA/i, 'installer QA never accesses live AppData');
assert.match(installerTest, /Join-Path \$isolatedRoot ["']userData["']/);
assert.match(installerTest, /Join-Path \$isolatedRoot ["']sessionData["']/, 'installer verifies Chromium session data under the isolated root');
assert.match(installerTest, /Get-ChildItem -LiteralPath \$isolatedSessionData/, 'installer requires packaged Chromium to populate isolated session data');
assert.match(installerTest, /\$isolatedRoot\s*=\s*\[IO\.Path\]::GetFullPath\(\(Join-Path \$env:TEMP/, 'installer normalizes the full isolated root before containment checks');
assert.match(installerTest, /StartsWith\(\$tempRootWithSeparator,\s*\[StringComparison\]::OrdinalIgnoreCase\)/, 'installer TEMP containment check handles short paths and Windows case-insensitivity');
assert.match(installerTest, /deleteAppDataOnUninstall\s*-ne\s*\$false/, 'installer validates the NSIS AppData preservation contract before launch');
assert.match(installerTest, /try\s*\{\s*if \(-not \$target\.StartsWith[\s\S]*?if \(-not \$isolatedRoot\.StartsWith[\s\S]*?deleteAppDataOnUninstall[\s\S]*?Start-Process -FilePath \$installer/, 'all installer preconditions and launch assertions are inside the cleanup transaction');
assert.match(installerTest, /taskkill\.exe \/PID \$process\.Id \/T \/F/, 'installer cleanup terminates only the launched Electron process tree');
assert.match(installerTest, /finally\s*\{[\s\S]*Start-Process -FilePath \$uninstaller[\s\S]*Remove-TestPath \$isolatedRoot[\s\S]*Remove-TestPath \$target/, 'installer uninstalls and removes both disposable roots transactionally');
assert.match(installerTest, /\$primaryFailure[\s\S]*\$cleanupFailures/, 'installer preserves primary failure context while collecting cleanup failures');
assert.match(installerTest, /param\(\[switch\]\$FailAfterInstall\)[\s\S]*if \(\$FailAfterInstall\) \{ throw ["']Injected failure after install\./, 'installer exposes a narrow failure injection for transactional cleanup regression testing');
assert.doesNotMatch(installerTest, /Remove-Item[^\r\n]+ErrorAction\s+SilentlyContinue/, 'installer cleanup never silently ignores removal failures');
assert.doesNotMatch(installerTest, /(?:marker|user data)[^\r\n]*uninstall|uninstall[^\r\n]*(?:marker|user data)/i, 'installer does not claim an arbitrary test root proves NSIS AppData preservation');
assert.match(installerTest, /marker[^\r\n]*process lifecycle/i, 'installer marker assertion is accurately limited to app process lifecycle');

const historicalRelease = fs.readFileSync(path.join(__dirname, 'release-1.1.0.ps1'), 'utf8');
assert.doesNotMatch(historicalRelease, /git\s+reset\s+--hard/i);
assert.doesNotMatch(historicalRelease, /^\s*#\s*\$WorkingTree/m);
assert.doesNotMatch(historicalRelease, /Set-Content[^\r\n]+(?:PackagePath|ChangelogPath)/i);
assert.match(historicalRelease, /\[IO\.File\]::WriteAllText/);
assert.match(historicalRelease, /UTF8Encoding\]\s*::new\(\$false\)/);
for (const writeCall of historicalRelease.match(/\[IO\.File\]::WriteAllText\([^\r\n]+/g) || []) {
  assert.match(writeCall, /\[Text\.UTF8Encoding\]::new\(\$false\)\)/, 'every release file write must be BOM-free');
}
assert.ok(historicalRelease.indexOf('$WorkingTree = & git status --porcelain') < historicalRelease.indexOf('[IO.File]::WriteAllText($PackagePath, $PackageJson'));

const mainSource = fs.readFileSync(path.join(root, 'src/main.cjs'), 'utf8');
assert.match(mainSource, /resolveIsolatedAppPaths\(process\.argv\)/);
assert.match(mainSource, /const allowTestInstance = process\.argv\.includes\("--allow-test-instance"\) \|\| Boolean\(selfTestPaths\)/);
assert.match(mainSource, /app\.setPath\("userData", targetUserDataPath\)/);
assert.match(mainSource, /app\.setPath\("sessionData", initialSessionDataPath\)/);
assert.match(mainSource, /const migrationPromise = isolatedPaths/);
assert.match(mainSource, /function activateAcceptedRuntime\(\)[\s\S]*?hasAcceptedCurrentTerms\(activeUserDataPath\)[\s\S]*?initializeAutoStart\(\);\s*configureAutoUpdater\(\);\s*checkForUpdates\(\);/);
assert.match(mainSource, /if \(hasAcceptedCurrentTerms\(activeUserDataPath\)\) activateAcceptedRuntime\(\);/);
assert.match(mainSource, /show:\s*!startHidden\s*\|\|\s*\(!isolatedTestMode\s*&&\s*!hasAcceptedCurrentTerms\(activeUserDataPath\)\)/, 'isolated tray QA may start hidden while production still surfaces unaccepted Terms');
assert.match(mainSource, /if \(!isolatedTestMode\s*&&\s*!hasAcceptedCurrentTerms\(activeUserDataPath\)\)\s*\{/, 'isolated tray QA may exercise close-to-tray while production still exits before Terms acceptance');

if (process.platform === 'win32') {
  const signatureProbe = spawnSync('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'verify-signature.ps1'),
    '-ResolveOnly', '-ReleaseFlavor', 'AVX2',
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(signatureProbe.status, 0, signatureProbe.stderr);
  const signaturePaths = JSON.parse(signatureProbe.stdout);
  assert.equal(path.basename(signaturePaths.installer), brand.installerName(packageJson.version, 'AVX2'));
  assert.equal(path.basename(signaturePaths.application), `${brand.displayName}.exe`);
  assert.equal(path.basename(signaturePaths.helper), brand.helperExecutable);
  const legacySignatureProbe = spawnSync('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'verify-signature.ps1'),
    '-ResolveOnly', '-ReleaseFlavor', 'Legacy',
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(legacySignatureProbe.status, 0, legacySignatureProbe.stderr);
  assert.equal(path.basename(JSON.parse(legacySignatureProbe.stdout).installer), brand.installerName(packageJson.version, 'Legacy'));
  const invalidSignatureProbe = spawnSync('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'verify-signature.ps1'),
    '-ResolveOnly', '-ReleaseFlavor', 'SSE2',
  ], { cwd: root, encoding: 'utf8' });
  assert.notEqual(invalidSignatureProbe.status, 0);
  const invalidEnvironmentSignatureProbe = spawnSync('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'verify-signature.ps1'),
    '-ResolveOnly',
  ], { cwd: root, encoding: 'utf8', env: { ...process.env, RELEASE_FLAVOR: 'SSE2' } });
  assert.notEqual(invalidEnvironmentSignatureProbe.status, 0, 'invalid RELEASE_FLAVOR environment fallback must fail');
  const signatureSource = fs.readFileSync(path.join(__dirname, 'verify-signature.ps1'), 'utf8');
  assert.match(signatureSource, /\[ValidateSet\(\s*["']Legacy["']\s*,\s*["']AVX2["']\s*\)\]/, 'signature verifier accepts only signed release flavors when one is passed');
  assert.doesNotMatch(signatureSource, /Get-ChildItem/);
}

// La descarga de modelos está activa en producción (1.2.3); solo el self-test empaquetado
// puede desactivarla con --self-test-local-only. El verificador y la app deben coincidir.
const localOnlyMainSource = fs.readFileSync(path.join(root, 'src', 'main.cjs'), 'utf8');
const packagedModelsSource = fs.readFileSync(path.join(__dirname, 'verify-packaged-models.cjs'), 'utf8');
assert.ok(
  localOnlyMainSource.includes('allowRemoteModels: !(selfTestPaths && process.argv.includes("--self-test-local-only"))'),
  'remote model downloads can only be disabled by the self-test flag'
);
assert.match(packagedModelsSource, /"--self-test-local-only"/, 'packaged model check disables downloads explicitly');

require('./generate-release-notes.test.cjs');
require('../src/self-test-paths.test.cjs');
require('../src/login-item-transition.test.cjs');

console.log('Release brand paths and script derivation verified.');
