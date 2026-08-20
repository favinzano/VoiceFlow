const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const configPath = path.join(__dirname, 'brand-config.json');
assert.ok(fs.existsSync(configPath), 'canonical brand config must exist');

const canonical = require('./brand-config.json');
const brand = require('./brand-config.cjs');
const packageJson = require('../package.json');

const expected = {
  displayName: 'felipe avinzano VoiceFlow',
  baseName: 'felipe avinzano Voice',
  suffix: 'Flow',
  slug: 'felipe-avinzanovoiceflow',
  appId: 'com.felipeavinzano.voiceflow',
  copper: '#B87333',
  developmentName: 'felipe avinzano VoiceFlow Development',
  helperBaseName: 'FelipeAvinzano.VoiceFlow.PasteHelper',
  repository: {
    owner: 'favinzano',
    name: 'VoiceFlow',
    slug: 'favinzano/VoiceFlow',
    url: 'https://github.com/favinzano/VoiceFlow',
  },
  legacyDataNames: [
    'NextStepAI Voice',
    'felipe avinzano Voice',
    'NextStepAI Voice Development',
    'felipe avinzano Voice Development',
  ],
};

assert.deepEqual(canonical, expected);
for (const [key, value] of Object.entries(expected)) {
  assert.deepEqual(brand[key], value, `brand.${key}`);
}
assert.equal(brand.issueUrl, `${expected.repository.url}/issues`);
assert.equal(brand.helperExecutable, `${expected.helperBaseName}.exe`);
assert.equal(
  brand.installerName('1.2.3'),
  'felipe-avinzanovoiceflow-Setup-1.2.3-x64.exe',
);
assert.equal(
  brand.installerName('1.2.3', 'beta'),
  'felipe-avinzanovoiceflow-Setup-1.2.3-beta-x64.exe',
);
assert.ok(Object.isFrozen(brand), 'brand export must be immutable');
assert.ok(Object.isFrozen(brand.repository), 'repository must be immutable');
assert.ok(Object.isFrozen(brand.legacyDataNames), 'legacy names must be immutable');

assert.equal(packageJson.name, expected.slug);
assert.equal(packageJson.description, `${expected.displayName} - dictado privado y local para Windows, macOS y Linux`);
assert.equal(packageJson.build.productName, expected.displayName);
assert.equal(packageJson.build.appId, expected.appId);
assert.deepEqual(packageJson.build.publish, [{
  provider: 'github',
  owner: expected.repository.owner,
  repo: expected.repository.name,
  releaseType: 'release',
}]);
assert.equal(packageJson.build.nsis.shortcutName, expected.displayName);
assert.equal(
  packageJson.build.win.artifactName,
  'felipe-avinzanovoiceflow-Setup-${version}-${arch}.${ext}',
);

assert.ok(packageJson.build.files.includes('src/**/*'), 'src files must be packaged');
assert.ok(
  packageJson.build.files.includes('assets/fonts/DMSerifDisplay-*.ttf'),
  'DM Serif font glob must be packaged',
);
assert.ok(
  fs.existsSync(path.join(projectRoot, 'assets', 'fonts', 'DMSerifDisplay-Regular.ttf')),
  'DM Serif Display font file must exist',
);

console.log('brand-config tests passed');
