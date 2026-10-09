const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");
const {
  clearTranscriptions,
  closeDb,
  dbPath,
  deleteTranscription,
  getAllTranscriptions,
  initDb,
  insertTranscription,
  migrateLegacyHistory,
  trimTranscriptions
} = require("./db.cjs");

async function run() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "voiceflow-db-"));
  initDb(root);

  assert.deepEqual(getAllTranscriptions(), []);

  const first = insertTranscription("hola mundo", "2026-01-01T00:00:00.000Z");
  assert.equal(first.texto, "hola mundo");
  assert.equal(first.fecha, "2026-01-01T00:00:00.000Z");
  assert.ok(Number.isInteger(first.id));

  const second = insertTranscription("segunda nota", "2026-01-02T00:00:00.000Z");
  let rows = getAllTranscriptions();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].texto, "segunda nota");
  assert.equal(rows[1].texto, "hola mundo");

  assert.equal(getAllTranscriptions(1).length, 1);

  deleteTranscription(first.id);
  rows = getAllTranscriptions();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, second.id);

  insertTranscription("tercera", "2026-01-03T00:00:00.000Z");
  insertTranscription("cuarta", "2026-01-04T00:00:00.000Z");
  trimTranscriptions(2);
  rows = getAllTranscriptions();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].texto, "cuarta");
  assert.equal(rows[1].texto, "tercera");

  clearTranscriptions();
  assert.deepEqual(getAllTranscriptions(), []);

  migrateLegacyHistory([
    { text: "reciente", at: "2026-02-02T00:00:00.000Z" },
    { text: "antigua", at: "2026-02-01T00:00:00.000Z" }
  ]);
  rows = getAllTranscriptions();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].texto, "reciente");
  assert.equal(rows[1].texto, "antigua");

  migrateLegacyHistory([{ text: "no debe insertarse", at: "2026-03-01T00:00:00.000Z" }]);
  assert.equal(getAllTranscriptions().length, 2);

  clearTranscriptions();
  const withLiteral = insertTranscription("Hola.", "2026-04-01T00:00:00.000Z", "eh hola");
  assert.equal(withLiteral.literal, "eh hola");
  const sameText = insertTranscription("Igual", "2026-04-02T00:00:00.000Z", "Igual");
  assert.equal(sameText.literal, null, "no duplica el literal cuando es idéntico");
  const onlyFormatting = insertTranscription("Hola, equipo. ", "2026-04-02T12:00:00.000Z", "hola equipo");
  assert.equal(onlyFormatting.literal, null, "mayúsculas, puntuación y espacio final no cuentan como diferencia");
  const plain = insertTranscription("Sin literal", "2026-04-03T00:00:00.000Z");
  assert.equal(plain.literal, null);
  rows = getAllTranscriptions();
  assert.equal(rows[0].literal, null);
  assert.equal(rows[3].literal, "eh hola");

  closeDb();

  // Una base creada antes de la columna literal se actualiza sin perder filas
  const legacyRoot = await fs.mkdtemp(path.join(os.tmpdir(), "voiceflow-db-legacy-"));
  const legacy = new Database(dbPath(legacyRoot));
  legacy.exec("CREATE TABLE transcriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, texto TEXT NOT NULL, fecha TEXT NOT NULL)");
  legacy.prepare("INSERT INTO transcriptions (texto, fecha) VALUES (?, ?)").run("antigua", "2026-01-01T00:00:00.000Z");
  legacy.close();
  initDb(legacyRoot);
  rows = getAllTranscriptions();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].texto, "antigua");
  assert.equal(rows[0].literal, null);
  closeDb();
  initDb(legacyRoot);
  assert.equal(getAllTranscriptions().length, 1, "reabrir la base es idempotente");
  closeDb();

  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(legacyRoot, { recursive: true, force: true });
  console.log("DB: 23 checks passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
