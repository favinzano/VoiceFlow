const path = require("node:path");
const Database = require("better-sqlite3");

const DB_FILENAME = "transcriptions.db";

let db;

function dbPath(userDataPath) {
  return path.join(userDataPath, DB_FILENAME);
}

function initDb(userDataPath) {
  db = new Database(dbPath(userDataPath));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS transcriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      texto TEXT NOT NULL,
      fecha TEXT NOT NULL
    )
  `);
  const columns = db.prepare("PRAGMA table_info(transcriptions)").all();
  if (!columns.some((column) => column.name === "literal")) {
    db.exec("ALTER TABLE transcriptions ADD COLUMN literal TEXT");
  }
  return db;
}

function requireDb() {
  if (!db) throw new Error("La base de datos de transcripciones no se ha inicializado.");
  return db;
}

function wordsOf(value) {
  return String(value).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

// El texto literal solo se guarda cuando las palabras difieren del texto final
// (muletillas, repeticiones...). Mayúsculas, puntuación y espacio final no cuentan.
function insertTranscription(texto, fecha = new Date().toISOString(), literal) {
  const storedLiteral = typeof literal === "string" && literal && wordsOf(literal) !== wordsOf(texto) ? literal : null;
  const result = requireDb()
    .prepare("INSERT INTO transcriptions (texto, fecha, literal) VALUES (?, ?, ?)")
    .run(texto, fecha, storedLiteral);
  return { id: result.lastInsertRowid, texto, fecha, literal: storedLiteral };
}

function getAllTranscriptions(limit) {
  const database = requireDb();
  if (Number.isFinite(limit)) {
    return database.prepare("SELECT id, texto, fecha, literal FROM transcriptions ORDER BY id DESC LIMIT ?").all(limit);
  }
  return database.prepare("SELECT id, texto, fecha, literal FROM transcriptions ORDER BY id DESC").all();
}

function deleteTranscription(id) {
  requireDb().prepare("DELETE FROM transcriptions WHERE id = ?").run(id);
}

function clearTranscriptions() {
  requireDb().exec("DELETE FROM transcriptions");
}

function trimTranscriptions(limit) {
  if (!Number.isFinite(limit) || limit < 0) return;
  requireDb()
    .prepare("DELETE FROM transcriptions WHERE id NOT IN (SELECT id FROM transcriptions ORDER BY id DESC LIMIT ?)")
    .run(limit);
}

function migrateLegacyHistory(entries) {
  const database = requireDb();
  const existing = database.prepare("SELECT COUNT(*) AS count FROM transcriptions").get();
  if (existing.count > 0 || !Array.isArray(entries) || !entries.length) return;
  const insert = database.prepare("INSERT INTO transcriptions (texto, fecha) VALUES (?, ?)");
  const insertMany = database.transaction((items) => {
    for (const item of items) {
      if (typeof item?.text === "string" && item.text.trim()) {
        insert.run(item.text, typeof item.at === "string" ? item.at : new Date().toISOString());
      }
    }
  });
  insertMany([...entries].reverse());
}

function closeDb() {
  if (db) {
    db.close();
    db = undefined;
  }
}

module.exports = {
  clearTranscriptions,
  closeDb,
  deleteTranscription,
  dbPath,
  getAllTranscriptions,
  initDb,
  insertTranscription,
  migrateLegacyHistory,
  trimTranscriptions
};
