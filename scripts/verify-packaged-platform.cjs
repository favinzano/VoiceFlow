'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const brand = require('../src/brand-config.cjs');

function argument(name) {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length);
  if (!value) throw new Error(`Missing ${prefix}<value>`);
  return value;
}

function assertFile(filePath, label) {
  assert.equal(fs.existsSync(filePath), true, `${label} is missing: ${filePath}`);
  assert.equal(fs.statSync(filePath).isFile(), true, `${label} is not a file: ${filePath}`);
}

function assertDirectoryAbsent(directoryPath, label) {
  assert.equal(fs.existsSync(directoryPath), false, `${label} should have been excluded: ${directoryPath}`);
}

function findNodeBinary(directoryPath) {
  if (!fs.existsSync(directoryPath)) return undefined;
  const name = fs.readdirSync(directoryPath).find((entry) => entry.endsWith('.node'));
  return name ? path.join(directoryPath, name) : undefined;
}

function verifyBinaryArchitecture(filePath, platform, arch) {
  if (platform === 'win32') return;
  const result = spawnSync('file', ['-b', filePath], { encoding: 'utf8' });
  assert.equal(result.status, 0, `Could not inspect native binary architecture: ${result.stderr}`);
  const description = result.stdout.toLowerCase();
  const expected = arch === 'arm64' ? /arm64|aarch64/ : /x86[_ -]64|x86-64|x86_64/;
  assert.match(description, expected, `${path.basename(filePath)} does not contain ${arch}: ${result.stdout.trim()}`);
}

const resources = path.resolve(argument('resources'));
const platform = argument('platform');
const arch = argument('arch');
assert.ok(['win32', 'darwin', 'linux'].includes(platform), `Unsupported platform: ${platform}`);

assertFile(path.join(resources, 'app.asar'), 'app.asar');
const unpackedModules = path.join(resources, 'app.asar.unpacked', 'node_modules');
const sqlite = path.join(unpackedModules, 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
const onnx = path.join(unpackedModules, 'onnxruntime-node', 'bin', 'napi-v3', platform, arch, 'onnxruntime_binding.node');
assertFile(sqlite, 'better-sqlite3 native binding');
assertFile(onnx, 'ONNX Runtime native binding');
verifyBinaryArchitecture(sqlite, platform, arch);
verifyBinaryArchitecture(onnx, platform, arch);

if (platform === 'win32') {
  assertFile(path.join(resources, 'native', 'win32-x64', brand.helperExecutable), 'Windows paste helper');
  assertDirectoryAbsent(path.join(unpackedModules, 'onnxruntime-node', 'bin', 'napi-v3', 'darwin'), 'macOS ONNX binaries');
  assertDirectoryAbsent(path.join(unpackedModules, 'onnxruntime-node', 'bin', 'napi-v3', 'linux'), 'Linux ONNX binaries');
  assertDirectoryAbsent(path.join(unpackedModules, 'uiohook-napi', 'prebuilds', 'darwin-x64'), 'macOS keyboard hook binaries');
  assertDirectoryAbsent(path.join(unpackedModules, 'uiohook-napi', 'prebuilds', 'linux-x64'), 'Linux keyboard hook binaries');
} else {
  const nutPackage = platform === 'darwin' ? 'libnut-darwin' : 'libnut-linux';
  const nut = path.join(unpackedModules, '@nut-tree-fork', nutPackage, 'build', 'Release', 'libnut.node');
  assertFile(nut, `${platform} keyboard automation binding`);
  verifyBinaryArchitecture(nut, platform, arch);
  // El modo mantener usa uiohook-napi en macOS y Linux: sin su binario no hay push-to-talk.
  const hook = findNodeBinary(path.join(unpackedModules, 'uiohook-napi', 'prebuilds', `${platform}-${arch}`));
  assert.ok(hook, `${platform} keyboard hook binding is missing for ${arch}`);
  verifyBinaryArchitecture(hook, platform, arch);
  assertDirectoryAbsent(path.join(unpackedModules, 'uiohook-napi', 'prebuilds', 'win32-x64'), 'Windows keyboard hook binaries');
  assertDirectoryAbsent(path.join(unpackedModules, 'onnxruntime-node', 'bin', 'napi-v3', 'win32'), 'Windows ONNX binaries');
  assertDirectoryAbsent(
    path.join(unpackedModules, 'onnxruntime-node', 'bin', 'napi-v3', platform === 'darwin' ? 'linux' : 'darwin'),
    'other-platform ONNX binaries'
  );
}

console.log(`Packaged ${platform}/${arch} runtime verified: app, database, inference and input automation bindings are present.`);
