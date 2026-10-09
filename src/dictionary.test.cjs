const assert = require("node:assert/strict");
const {
  MAX_ALIASES,
  MAX_ENTRIES,
  MAX_TERM_LENGTH,
  addEntry,
  applyDictionary,
  normalizeDictionary,
  normalizeEntry,
  parseEntryInput,
  phoneticKey
} = require("./dictionary.cjs");

let checks = 0;
function check(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
  checks += 1;
}

// Normalización de entradas
check(normalizeEntry("  VoiceFlow  "), { term: "VoiceFlow", aliases: [] }, "recorta espacios");
check(normalizeEntry("José"), { term: "José", aliases: [] }, "NFD pasa a NFC");
check(normalizeEntry("Next   Step\tAI"), { term: "Next Step AI", aliases: [] }, "colapsa espacios internos");
check(normalizeEntry(""), null, "rechaza vacío");
check(normalizeEntry("   "), null, "rechaza solo espacios");
check(normalizeEntry(42), null, "rechaza tipos no válidos");
check(normalizeEntry("a".repeat(MAX_TERM_LENGTH + 1)), null, "rechaza términos demasiado largos");
check(normalizeEntry("a".repeat(MAX_TERM_LENGTH)).term.length, MAX_TERM_LENGTH, "acepta el largo máximo");
check(normalizeEntry("Hola\u0000Mundo").term, "HolaMundo", "quita caracteres de control");
check(
  normalizeEntry({ term: "NextStepAI", aliases: ["nexto step ai", "NEXTO STEP AI", "  ", "nextstepai"] }),
  { term: "NextStepAI", aliases: ["nexto step ai"] },
  "aliases únicos, sin vacíos y sin repetir el término"
);
check(
  normalizeEntry({ term: "X", aliases: Array.from({ length: MAX_ALIASES + 3 }, (_, i) => `alias${i}`) }).aliases.length,
  MAX_ALIASES,
  "limita la cantidad de aliases"
);

// Entrada desde texto: "término = alias1, alias2"
check(parseEntryInput("NextStepAI = nexto step ai, next step ai"), { term: "NextStepAI", aliases: ["nexto step ai", "next step ai"] }, "parsea aliases");
check(parseEntryInput("VoiceFlow"), { term: "VoiceFlow", aliases: [] }, "parsea solo término");
check(parseEntryInput("= alias"), null, "rechaza término vacío");

// Normalización de listas
check(normalizeDictionary(["VoiceFlow", "voiceflow", "Aztec"]), ["VoiceFlow", "Aztec"], "sin duplicados, sin distinguir mayúsculas");
check(normalizeDictionary(["VoiceFlow", 5, null, "", { nope: true }]), ["VoiceFlow"], "descarta entradas inválidas");
check(normalizeDictionary("no es lista"), [], "tolera entrada que no es lista");
check(
  normalizeDictionary([{ term: "NextStepAI", aliases: ["nexto step ai"] }, "Aztec"]),
  [{ term: "NextStepAI", aliases: ["nexto step ai"] }, "Aztec"],
  "conserva cadenas simples y objetos con alias"
);
check(
  normalizeDictionary(Array.from({ length: MAX_ENTRIES + 10 }, (_, i) => `termino${i}`)).length,
  MAX_ENTRIES,
  "limita la cantidad de entradas"
);

// Alta inmutable
const base = ["VoiceFlow"];
const added = addEntry(base, "Aztec");
check(base, ["VoiceFlow"], "addEntry no muta la lista original");
check(added, { dictionary: ["Aztec", "VoiceFlow"], added: true, reason: undefined }, "alta al inicio");
check(addEntry(base, "voiceflow").reason, "duplicate", "rechaza duplicado");
check(addEntry(base, "").reason, "invalid", "rechaza vacío");
check(
  addEntry(Array.from({ length: MAX_ENTRIES }, (_, i) => `t${i}x`), "Nuevo").reason,
  "full",
  "rechaza cuando la lista está llena"
);

// Clave fonética
check(phoneticKey("Víctor") === phoneticKey("Biktor"), true, "v y b suenan igual");
check(phoneticKey("zapato") === phoneticKey("sapato"), true, "z y s suenan igual");
check(phoneticKey("hola") === phoneticKey("ola"), true, "h muda");
check(phoneticKey("casa") === phoneticKey("kasa"), true, "c y k");
check(phoneticKey("casa") === phoneticKey("mesa"), false, "palabras distintas");

// Aplicación: coincidencia exacta
check(applyDictionary("hablamos de voiceflow hoy", ["VoiceFlow"]), "hablamos de VoiceFlow hoy", "ajusta mayúsculas");
check(applyDictionary("uso voiceflowing", ["VoiceFlow"]), "uso voiceflowing", "respeta límites de palabra");
check(applyDictionary("hola", []), "hola", "lista vacía no cambia nada");
check(applyDictionary("", ["VoiceFlow"]), "", "texto vacío");

// Aliases
check(
  applyDictionary("abre nexto step ai ahora", [{ term: "NextStepAI", aliases: ["nexto step ai"] }]),
  "abre NextStepAI ahora",
  "alias de varias palabras"
);
check(
  applyDictionary("Nexto   Step AI funciona", [{ term: "NextStepAI", aliases: ["nexto step ai"] }]),
  "NextStepAI funciona",
  "alias sin distinguir mayúsculas ni espacios"
);

// Coincidencia aproximada
check(applyDictionary("probamos voiceflo ayer", ["VoiceFlow"]), "probamos VoiceFlow ayer", "una letra faltante");
check(applyDictionary("probamos boiceflow ayer", ["VoiceFlow"]), "probamos VoiceFlow ayer", "v y b confundidas");
check(applyDictionary("abre next step ai ahora", ["NextStepAI"]), "abre NextStepAI ahora", "palabras separadas que forman el término");
check(applyDictionary("habla con Jose ahora", ["José"]), "habla con José ahora", "acento omitido");

// Lo que no debe cambiar
check(applyDictionary("la cosa es grande", ["Cassa"]), "la cosa es grande", "palabra común cercana pero fuera del umbral");
check(applyDictionary("voy a la mesa", ["Aztec"]), "voy a la mesa", "palabra no relacionada");
check(applyDictionary("el sol sale", ["Sal"]), "el sol sale", "términos cortos solo coinciden exactamente");
check(applyDictionary("escribe a soporte@voiceflo.com", ["VoiceFlow"]), "escribe a soporte@voiceflo.com", "no toca correos");
check(applyDictionary("visita https://voiceflo.com/ayuda", ["VoiceFlow"]), "visita https://voiceflo.com/ayuda", "no toca direcciones web");

// Umbral configurable
check(applyDictionary("probamos voiceflo ayer", ["VoiceFlow"], { threshold: 0 }), "probamos voiceflo ayer", "umbral 0 desactiva lo aproximado");
check(applyDictionary("hablamos de voiceflow", ["VoiceFlow"], { threshold: 0 }), "hablamos de VoiceFlow", "umbral 0 conserva lo exacto");

// Guardia de contenido: demasiados reemplazos aproximados se descartan
const crowded = "boiceflow boiceflow boiceflow boiceflow";
check(applyDictionary(crowded, ["VoiceFlow"]), crowded, "demasiados reemplazos aproximados conservan el original");

// Compatibilidad con listas guardadas de solo cadenas
check(applyDictionary("hablamos de voiceflow", ["VoiceFlow", "Aztec"]), "hablamos de VoiceFlow", "lista de cadenas");

// Umbral inválido o fuera de rango
check(applyDictionary("probamos voiceflo ayer", ["VoiceFlow"], { threshold: NaN }), "probamos VoiceFlow ayer", "NaN usa el umbral por defecto");
check(applyDictionary("probamos voiceflo ayer", ["VoiceFlow"], { threshold: "abc" }), "probamos VoiceFlow ayer", "texto usa el umbral por defecto");
check(applyDictionary("la mesa y el sol", ["Aztec"], { threshold: 5 }), "la mesa y el sol", "umbral enorme se limita y no reescribe todo");
check(applyDictionary("probamos voiceflo ayer", ["VoiceFlow"], { threshold: -1 }), "probamos voiceflo ayer", "umbral negativo desactiva lo aproximado");

// Aliases demasiado cortos reescribirían texto normal
check(normalizeEntry({ term: "Aztec", aliases: ["a", "de", "aztek"] }), { term: "Aztec", aliases: ["aztek"] }, "descarta aliases de menos de 3 letras");

// Rendimiento: dictado largo con diccionario grande
const longWords = ["casa", "tiempo", "proyecto", "reunión", "mañana", "cliente", "revisar", "documento", "equipo", "propuesta"];
const longText = Array.from({ length: 3000 }, (_, index) => longWords[index % 10]).join(" ");
const bigDictionary = Array.from({ length: MAX_ENTRIES }, (_, index) => `Termino${String.fromCharCode(97 + (index % 26))}${index}`);
const startedAt = Date.now();
applyDictionary(longText, bigDictionary);
check(Date.now() - startedAt < 4000, true, "3000 palabras con 200 términos en menos de 4 s");

console.log(`Dictionary: ${checks} checks passed`);
