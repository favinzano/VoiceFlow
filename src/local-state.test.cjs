const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  STATE_SCHEMA_VERSION,
  backupPath,
  migrateLegacyState,
  normalizeState,
  readState,
  statePath,
  writeState
} = require("./local-state.cjs");

async function run() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "voiceflow-state-"));
  assert.equal((await readState(root)).schemaVersion, STATE_SCHEMA_VERSION);

  const initial = await migrateLegacyState(root, {
    settings: { language: "spanish" },
    history: [{ text: "hola" }],
    dictionary: ["VoiceFlow"],
    microphone: "mic-1"
  });
  assert.equal(initial.history.length, 1);
  assert.equal(initial.microphone, "mic-1");

  await writeState(root, { ...initial, history: [{ text: "actualizado" }] });
  assert.equal((await readState(root)).history[0].text, "actualizado");
  assert.ok((await fs.stat(backupPath(root))).size > 0);

  await fs.writeFile(statePath(root), "{corrupt", "utf8");
  assert.equal((await readState(root)).history[0].text, "hola");
  assert.equal((await readState(root)).history[0].text, "hola");

  const preserved = await migrateLegacyState(root, { history: [{ text: "no sobrescribir" }] });
  assert.equal(preserved.history[0].text, "hola");
  await assert.rejects(() => writeState(root, { schemaVersion: STATE_SCHEMA_VERSION + 1 }));

  const dictionaryState = normalizeState({
    dictionary: ["Aztec", "aztec", { term: "Avinzano", aliases: ["abinsano"] }, 7, ""]
  });
  assert.deepEqual(dictionaryState.dictionary, ["Aztec", { term: "Avinzano", aliases: ["abinsano"] }]);

  await fs.rm(root, { recursive: true, force: true });
  console.log("Local state: 10 checks passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
