"use strict";

const { MAX_ALIASES, addEntry, normalizeDictionary, normalizeEntry } = require("./dictionary.cjs");

const MAX_SPAN_WORDS = 4;
const MAX_SUGGESTIONS = 5;
const MIN_ANCHOR_WORDS = 2;

function toWords(text) {
  if (typeof text !== "string") return [];
  return text
    .normalize("NFC")
    .split(/\s+/)
    .map((raw) => raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean)
    .map((display) => ({ display, key: display.toLocaleLowerCase() }));
}

// Alinea ambas listas por subsecuencia común más larga y devuelve las operaciones en orden.
function align(left, right) {
  const table = Array.from({ length: left.length + 1 }, () => new Array(right.length + 1).fill(0));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i][j] = left[i].key === right[j].key ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const operations = [];
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i].key === right[j].key) {
      operations.push({ type: "match" });
      i += 1;
      j += 1;
    } else if (j >= right.length || (i < left.length && table[i + 1][j] >= table[i][j + 1])) {
      operations.push({ type: "delete", word: left[i] });
      i += 1;
    } else {
      operations.push({ type: "insert", word: right[j] });
      j += 1;
    }
  }
  return operations;
}

function collectReplacements(operations) {
  const replacements = [];
  let heard = [];
  let corrected = [];
  const flush = () => {
    if (heard.length && corrected.length) replacements.push({ heard, corrected });
    heard = [];
    corrected = [];
  };
  for (const operation of operations) {
    if (operation.type === "match") flush();
    else if (operation.type === "delete") heard.push(operation.word);
    else corrected.push(operation.word);
  }
  flush();
  return replacements;
}

// Compara lo que se transcribió con lo que el usuario corrigió y propone pares término <- alias.
function suggestCorrections(original, corrected) {
  const heardWords = toWords(original);
  const correctedWords = toWords(corrected);
  if (!heardWords.length || !correctedWords.length) return [];
  const replacements = collectReplacements(align(heardWords, correctedWords));
  // Si casi nada coincide, el usuario reescribió el texto: no es una corrección de palabras.
  const changedWords = replacements.reduce((total, item) => total + item.heard.length, 0);
  const anchors = heardWords.length - changedWords;
  if (anchors < Math.min(MIN_ANCHOR_WORDS, heardWords.length - 1)) return [];

  const suggestions = [];
  for (const { heard, corrected: fixed } of replacements) {
    if (heard.length > MAX_SPAN_WORDS || fixed.length > MAX_SPAN_WORDS) continue;
    const alias = heard.map((word) => word.display).join(" ");
    const term = fixed.map((word) => word.display).join(" ");
    const entry = normalizeEntry({ term, aliases: [alias] });
    if (!entry || !entry.aliases.length) continue;
    suggestions.push({ term: entry.term, alias: entry.aliases[0] });
    if (suggestions.length >= MAX_SUGGESTIONS) break;
  }
  return suggestions;
}

// Guarda un alias aprendido: si el término ya existe lo añade a esa entrada; si no, crea la entrada.
function learnAlias(list, { term, alias } = {}) {
  const current = normalizeDictionary(list);
  const candidate = normalizeEntry({ term, aliases: [alias] });
  if (!candidate || !candidate.aliases.length) return { dictionary: current, added: false, reason: "invalid" };

  const sameText = (left, right) => left.toLocaleLowerCase() === right.toLocaleLowerCase();
  const termOf = (item) => (typeof item === "string" ? item : item.term);
  const index = current.findIndex((item) => sameText(termOf(item), candidate.term));
  if (index < 0) return addEntry(current, candidate);

  const existing = normalizeEntry(current[index]);
  if (existing.aliases.some((known) => sameText(known, candidate.aliases[0]))) {
    return { dictionary: current, added: false, reason: "duplicate" };
  }
  if (existing.aliases.length >= MAX_ALIASES) return { dictionary: current, added: false, reason: "aliases-full" };
  const merged = normalizeEntry({ term: existing.term, aliases: [...existing.aliases, candidate.aliases[0]] });
  return {
    dictionary: current.map((item, position) => (position === index ? merged : item)),
    added: true,
    reason: undefined
  };
}

module.exports = { learnAlias, suggestCorrections };
