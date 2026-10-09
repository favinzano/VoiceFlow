const fs = require("node:fs/promises");
const path = require("node:path");
const { normalizeDictionary } = require("./dictionary.cjs");

const STATE_SCHEMA_VERSION = 1;

function statePath(userDataPath) {
  return path.join(userDataPath, "voice-state.json");
}

function backupPath(userDataPath) {
  return `${statePath(userDataPath)}.backup`;
}

function normalizeState(state = {}) {
  if (Number(state.schemaVersion || 0) > STATE_SCHEMA_VERSION) {
    throw new Error(`Unsupported state schema version: ${state.schemaVersion}`);
  }
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    settings: state.settings && typeof state.settings === "object" ? state.settings : {},
    history: Array.isArray(state.history) ? state.history : [],
    dictionary: normalizeDictionary(state.dictionary),
    microphone: typeof state.microphone === "string" ? state.microphone : ""
  };
}

async function parseFile(filePath) {
  return normalizeState(JSON.parse(await fs.readFile(filePath, "utf8")));
}

async function readState(userDataPath) {
  try {
    return await parseFile(statePath(userDataPath));
  } catch (error) {
    if (error.code !== "ENOENT" && error.name !== "SyntaxError") throw error;
  }
  try {
    const recovered = await parseFile(backupPath(userDataPath));
    await writeState(userDataPath, recovered);
    return recovered;
  } catch (error) {
    if (error.code !== "ENOENT" && error.name !== "SyntaxError") throw error;
    return normalizeState();
  }
}

async function writeState(userDataPath, state) {
  const normalized = normalizeState(state);
  const destination = statePath(userDataPath);
  const temporary = `${destination}.${process.pid}.tmp`;
  await fs.mkdir(userDataPath, { recursive: true });
  try {
    await fs.copyFile(destination, backupPath(userDataPath));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await fs.writeFile(temporary, JSON.stringify(normalized, null, 2), "utf8");
  await fs.rename(temporary, destination);
  return normalized;
}

async function migrateLegacyState(userDataPath, legacyState) {
  try {
    await fs.access(statePath(userDataPath));
    return readState(userDataPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return writeState(userDataPath, legacyState);
  }
}

module.exports = {
  STATE_SCHEMA_VERSION,
  backupPath,
  migrateLegacyState,
  normalizeState,
  readState,
  statePath,
  writeState
};
