const assert = require("node:assert/strict");
const { cleanTranscription, cleanTranscriptionDetailed } = require("./text-cleanup.cjs");

const cleanupCases = [
  ["eh bueno necesito necesito enviar esto", "Necesito enviar esto."],
  ["bueno, o sea, tenemos tenemos que revisar la propuesta", "Tenemos que revisar la propuesta."],
  ["a ver, básicamente necesitamos revisar revisar el documento", "Necesitamos revisar el documento."],
  ["vamos a el evento de el martes", "Vamos al evento del martes."],
  ["no se si debemos avanzar", "No sé si debemos avanzar."],
  ["hola     equipo   necesitamos   avanzar", "Hola equipo necesitamos avanzar."],
  ["hola coma equipo punto y aparte nos vemos mañana", "Hola, equipo.\n\nNos vemos mañana."],
  ["hola punto nos vemos mañana", "Hola. Nos vemos mañana."],
  ["hola. . . . nos vemos mañana", "Hola. Nos vemos mañana."],
  ["...", ""],
  [". . .", ""],
  ["   ", ""],
  ["[Música]", ""],
  ["(Aplausos)", ""],
  ["gracias por ver el video", ""],
  ["y", ""],
  ["la.", ""],
  ["sí", "Sí."],
  ["quiero agregar música al video", "Quiero agregar música al video."]
];

const addressCases = [
  ["escribe a soporte arroba felipeavinzano punto com", "Escribe a soporte@felipeavinzano.com."],
  ["mi correo es felipe punto avinzano arroba gmail punto com", "Mi correo es felipe.avinzano@gmail.com."],
  ["contacta ventas guion latam arroba felipeavinzano punto com", "Contacta ventas-latam@felipeavinzano.com."],
  ["escribe a soporte arroba felipe avinzano punto com", "Escribe a soporte@felipeavinzano.com."],
  ["visita felipeavinzano punto com", "Visita felipeavinzano.com."],
  ["visita felipe avinzano punto com", "Visita felipeavinzano.com."],
  ["visita www punto felipeavinzano punto com", "Visita www.felipeavinzano.com."],
  ["abre felipeavinzano punto com slash contacto", "Abre felipeavinzano.com/contacto."],
  ["soporte@felipeavinzano.com", "soporte@felipeavinzano.com"],
  ["https://felipeavinzano.com/contacto", "https://felipeavinzano.com/contacto"]
];

const structureInput = [
  "necesitamos revisar el proyecto porque el cliente solicitó cambios importantes en la propuesta,",
  "además debemos actualizar el presupuesto y confirmar las fechas con el equipo",
  "por último enviaremos la versión final mañana"
].join(" ");

const structureExpected = [
  "Necesitamos revisar el proyecto porque el cliente solicitó cambios importantes en la propuesta.",
  "",
  "Además debemos actualizar el presupuesto y confirmar las fechas con el equipo.",
  "",
  "Por último enviaremos la versión final mañana."
].join("\n");

for (const [input, expected] of [...cleanupCases, ...addressCases]) {
  assert.equal(cleanTranscription(input), expected, input);
}

assert.equal(cleanTranscription(structureInput), structureExpected, "estructura discursiva");
assert.equal(
  cleanTranscription("hablamos de voiceflow", { dictionary: ["VoiceFlow"] }),
  "Hablamos de VoiceFlow."
);
assert.equal(cleanTranscription("eh bueno hola", { cleanup: false }), "Eh bueno hola.");
assert.equal(cleanTranscription("hola", { appendSpace: true }), "Hola. ");

// Transcripción literal y guardia de contenido
const detailed = cleanTranscriptionDetailed("  eh   bueno hola  ");
assert.equal(detailed.literal, "eh bueno hola", "literal conserva las palabras con espacios normalizados");
assert.equal(detailed.text, "Hola.", "texto limpio");
assert.equal(detailed.guarded, false, "sin guardia en limpieza normal");

const repeated = cleanTranscriptionDetailed("no no no no no no no no");
assert.equal(repeated.guarded, true, "la guardia se activa si la limpieza se come la mitad del contenido");
assert.equal(repeated.text, "No no no no no no no no.", "se conserva el contenido sin quitar repeticiones");
assert.equal(repeated.literal, "no no no no no no no no");
assert.equal(cleanTranscription("no no no no no no no no"), "No no no no no no no no.", "cleanTranscription aplica la guardia");

assert.equal(cleanTranscriptionDetailed("sí sí").guarded, false, "frases cortas no activan la guardia");
assert.equal(cleanTranscriptionDetailed("gracias por ver el video").text, "", "artefactos de silencio siguen descartándose");
assert.equal(cleanTranscriptionDetailed("[Música]").literal, "[Música]", "el literal se conserva aunque el texto quede vacío");
assert.equal(cleanTranscriptionDetailed("").literal, "", "literal vacío");
assert.equal(
  cleanTranscriptionDetailed("eh bueno hola", { cleanup: false }).guarded,
  false,
  "sin limpieza no hay guardia"
);

console.log(`${cleanupCases.length + addressCases.length + 15} text pipeline cases passed`);
