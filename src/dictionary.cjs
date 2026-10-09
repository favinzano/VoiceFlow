"use strict";

const MAX_TERM_LENGTH = 80;
const MAX_ALIASES = 5;
const MAX_ENTRIES = 200;
const DEFAULT_THRESHOLD = 0.18;
const MAX_THRESHOLD = 0.4;
const MIN_FUZZY_LENGTH = 4;
const MIN_ALIAS_LENGTH = 3;
const MAX_WINDOW_WORDS = 4;
const MIN_FUZZY_REPLACEMENT_CAP = 2;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(value) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFC")
    .replace(/[\u0000-\u001F\u007F]/g, (character) => (/\s/.test(character) ? " " : ""))
    .replace(/\s+/g, " ")
    .trim();
}

function sameText(left, right) {
  return left.toLocaleLowerCase() === right.toLocaleLowerCase();
}

function normalizeAliases(rawAliases, term) {
  if (!Array.isArray(rawAliases)) return [];
  const aliases = [];
  for (const raw of rawAliases) {
    const alias = normalizeText(raw);
    if (!alias || alias.length > MAX_TERM_LENGTH || compact(alias).length < MIN_ALIAS_LENGTH) continue;
    if (sameText(alias, term)) continue;
    if (aliases.some((existing) => sameText(existing, alias))) continue;
    aliases.push(alias);
    if (aliases.length >= MAX_ALIASES) break;
  }
  return aliases;
}

function normalizeEntry(value) {
  const source = typeof value === "string" ? { term: value } : value;
  if (!source || typeof source !== "object") return null;
  const term = normalizeText(source.term);
  if (!term || term.length > MAX_TERM_LENGTH) return null;
  return { term, aliases: normalizeAliases(source.aliases, term) };
}

function serializeEntry(entry) {
  return entry.aliases.length ? entry : entry.term;
}

function normalizeDictionary(list) {
  if (!Array.isArray(list)) return [];
  const entries = [];
  for (const item of list) {
    const entry = normalizeEntry(item);
    if (!entry) continue;
    if (entries.some((existing) => sameText(existing.term, entry.term))) continue;
    entries.push(entry);
    if (entries.length >= MAX_ENTRIES) break;
  }
  return entries.map(serializeEntry);
}

function addEntry(list, input) {
  const current = normalizeDictionary(list);
  const entry = normalizeEntry(input);
  if (!entry) return { dictionary: current, added: false, reason: "invalid" };
  const termOf = (item) => (typeof item === "string" ? item : item.term);
  if (current.some((item) => sameText(termOf(item), entry.term))) {
    return { dictionary: current, added: false, reason: "duplicate" };
  }
  if (current.length >= MAX_ENTRIES) return { dictionary: current, added: false, reason: "full" };
  return { dictionary: [serializeEntry(entry), ...current], added: true, reason: undefined };
}

// "término = alias uno, alias dos" -> entrada con alias.
function parseEntryInput(text) {
  if (typeof text !== "string") return null;
  const separator = text.indexOf("=");
  if (separator < 0) return normalizeEntry(text);
  const aliases = text.slice(separator + 1).split(",");
  return normalizeEntry({ term: text.slice(0, separator), aliases });
}

function stripDiacritics(value) {
  return value.normalize("NFD").replace(/\p{M}/gu, "");
}

function compact(value) {
  return stripDiacritics(String(value).toLocaleLowerCase()).replace(/[^\p{L}\p{N}]/gu, "");
}

// Clave fonética aproximada para español: iguala v/b, z/c/s, h muda, qu/k, ll/y, etc.
function phoneticKey(word) {
  return compact(word)
    .replace(/ch/g, "#")
    .replace(/qu/g, "k")
    .replace(/gu(?=[ei])/g, "g")
    .replace(/ll/g, "y")
    .replace(/c(?=[ei])/g, "s")
    .replace(/g(?=[ei])/g, "j")
    .replace(/c/g, "k")
    .replace(/z/g, "s")
    .replace(/v/g, "b")
    .replace(/w/g, "u")
    .replace(/h/g, "")
    .replace(/(.)\1+/g, "$1");
}

// Con `limit` corta en cuanto toda una fila lo supera: el resultado exacto solo importa por debajo de él.
function editDistance(left, right, limit = Infinity) {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    let rowMinimum = row;
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      current[column] = Math.min(previous[column] + 1, current[column - 1] + 1, previous[column - 1] + cost);
      if (current[column] < rowMinimum) rowMinimum = current[column];
    }
    if (rowMinimum > limit) return limit + 1;
    previous = current;
  }
  return previous[right.length];
}

function similarityRatio(candidate, candidatePhonetic, target, targetPhonetic, threshold) {
  const longestRaw = Math.max(candidate.length, target.length);
  const raw = editDistance(candidate, target, Math.floor(threshold * longestRaw)) / longestRaw;
  if (raw === 0) return 0;
  const longest = Math.max(candidatePhonetic.length, targetPhonetic.length) || 1;
  const phonetic = editDistance(candidatePhonetic, targetPhonetic, Math.floor(threshold * longest)) / longest;
  return Math.min(raw, phonetic);
}

function applyExactMatches(text, entries) {
  return entries.reduce((result, { term, aliases }) => {
    return [term, ...aliases].reduce((current, variant) => {
      const pattern = escapeRegExp(variant).replace(/ /g, "\\s+");
      return current.replace(new RegExp(`(?<![\\p{L}\\p{N}_])${pattern}(?![\\p{L}\\p{N}_])`, "giu"), term);
    }, result);
  }, text);
}

function tokenize(text) {
  return Array.from(text.matchAll(/[\p{L}\p{N}]+/gu), (match) => ({
    text: match[0],
    start: match.index,
    end: match.index + match[0].length
  }));
}

// No tocar fragmentos de correos, direcciones web ni dominios.
function isInsideAddress(text, start, end) {
  const before = text[start - 1];
  const after = text[end];
  if (before && "@/:_".includes(before)) return true;
  if (after && "@/_".includes(after)) return true;
  if (before === "." && /[\p{L}\p{N}]/u.test(text[start - 2] || "")) return true;
  return after === "." && /[\p{L}\p{N}]/u.test(text[end + 1] || "");
}

function buildWindows(text, tokens) {
  const windows = [];
  for (let first = 0; first < tokens.length; first += 1) {
    for (let size = 1; size <= MAX_WINDOW_WORDS && first + size <= tokens.length; size += 1) {
      const last = first + size - 1;
      if (size > 1 && !/^ +$/.test(text.slice(tokens[last - 1].end, tokens[last].start))) break;
      const start = tokens[first].start;
      const end = tokens[last].end;
      const original = text.slice(start, end);
      const joined = compact(original);
      if (joined.length < MIN_FUZZY_LENGTH || isInsideAddress(text, start, end)) continue;
      windows.push({ start, end, original, joined, phonetic: phoneticKey(joined) });
    }
  }
  return windows;
}

// Cota inferior barata: la diferencia de longitud ya impone una distancia mínima.
function canBeWithinThreshold(window, target, targetPhonetic, threshold) {
  const rawBound = Math.abs(window.joined.length - target.length) / Math.max(window.joined.length, target.length);
  if (rawBound <= threshold) return true;
  const longest = Math.max(window.phonetic.length, targetPhonetic.length) || 1;
  return Math.abs(window.phonetic.length - targetPhonetic.length) / longest <= threshold;
}

function collectFuzzyCandidates(text, tokens, entries, threshold) {
  const candidates = [];
  const knownForms = new Set(entries.flatMap(({ term, aliases }) => [term, ...aliases].map(compact)));
  const windows = buildWindows(text, tokens);
  for (const { term } of entries) {
    const target = compact(term);
    if (target.length < MIN_FUZZY_LENGTH) continue;
    const targetPhonetic = phoneticKey(target);
    for (const window of windows) {
      if (window.original === term || !canBeWithinThreshold(window, target, targetPhonetic, threshold)) continue;
      if (window.joined !== target && knownForms.has(window.joined)) continue;
      const ratio = similarityRatio(window.joined, window.phonetic, target, targetPhonetic, threshold);
      if (ratio <= threshold) candidates.push({ start: window.start, end: window.end, term, ratio });
    }
  }
  return candidates;
}

function selectNonOverlapping(candidates) {
  const ranked = [...candidates].sort(
    (left, right) => left.ratio - right.ratio || (right.end - right.start) - (left.end - left.start)
  );
  const accepted = [];
  for (const candidate of ranked) {
    if (accepted.some((item) => candidate.start < item.end && item.start < candidate.end)) continue;
    accepted.push(candidate);
  }
  return accepted.sort((left, right) => right.start - left.start);
}

function applyFuzzyMatches(text, entries, threshold) {
  const tokens = tokenize(text);
  if (!tokens.length) return text;
  const accepted = selectNonOverlapping(collectFuzzyCandidates(text, tokens, entries, threshold));
  const cap = Math.max(MIN_FUZZY_REPLACEMENT_CAP, Math.ceil(tokens.length * 0.5));
  if (!accepted.length || accepted.length > cap) return text;
  return accepted.reduce(
    (result, { start, end, term }) => result.slice(0, start) + term + result.slice(end),
    text
  );
}

function resolveThreshold(value) {
  if (value === undefined || value === null) return DEFAULT_THRESHOLD;
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_THRESHOLD;
  return Math.min(Math.max(number, 0), MAX_THRESHOLD);
}

function applyDictionary(text, dictionary, options = {}) {
  const threshold = resolveThreshold(options.threshold);
  if (!text) return text;
  const entries = normalizeDictionary(dictionary).map(normalizeEntry);
  if (!entries.length) return text;
  const exact = applyExactMatches(text, entries);
  if (!(threshold > 0)) return exact;
  return applyFuzzyMatches(exact, entries, threshold);
}

module.exports = {
  DEFAULT_THRESHOLD,
  MAX_ALIASES,
  MAX_ENTRIES,
  MAX_TERM_LENGTH,
  addEntry,
  applyDictionary,
  normalizeDictionary,
  normalizeEntry,
  parseEntryInput,
  phoneticKey
};
