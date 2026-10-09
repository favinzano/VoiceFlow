const assert = require("node:assert/strict");
const { learnAlias, suggestCorrections } = require("./word-learning.cjs");

function run() {
  // Una palabra mal oída
  assert.deepEqual(
    suggestCorrections("Hablé con Abinsano ayer", "Hablé con Avinzano ayer"),
    [{ term: "Avinzano", alias: "Abinsano" }]
  );
  // Varias palabras a una (y viceversa)
  assert.deepEqual(
    suggestCorrections("Usamos nexto step ai hoy", "Usamos NextStepAI hoy"),
    [{ term: "NextStepAI", alias: "nexto step ai" }]
  );
  assert.deepEqual(
    suggestCorrections("Abre VoiceFlow ahora", "Abre voz flow ahora").length,
    1
  );
  // Puntuación en los bordes no entra en el término ni en el alias
  assert.deepEqual(
    suggestCorrections("Hola, Abinsano.", "Hola, Avinzano."),
    [{ term: "Avinzano", alias: "Abinsano" }]
  );
  // Cambios solo de mayúsculas o puntuación no enseñan nada
  assert.deepEqual(suggestCorrections("hola mundo", "Hola mundo"), []);
  assert.deepEqual(suggestCorrections("hola mundo", "hola, mundo"), []);
  // Sin cambios, solo inserciones o solo borrados: nada que aprender
  assert.deepEqual(suggestCorrections("hola mundo", "hola mundo"), []);
  assert.deepEqual(suggestCorrections("hola mundo", "hola querido mundo"), []);
  assert.deepEqual(suggestCorrections("hola querido mundo", "hola mundo"), []);
  // Reescritura casi total: no es una corrección
  assert.deepEqual(suggestCorrections("uno dos tres cuatro", "alfa beta gamma delta"), []);
  // Varias correcciones en un mismo texto
  const many = suggestCorrections("Abinsano trabaja en nexto step ai con Karla", "Avinzano trabaja en NextStepAI con Carla");
  assert.deepEqual(many.map((s) => s.term), ["Avinzano", "NextStepAI", "Carla"]);
  // Entradas inválidas
  assert.deepEqual(suggestCorrections(undefined, "x"), []);
  assert.deepEqual(suggestCorrections("x", null), []);
  // Alias demasiado corto para el diccionario
  assert.deepEqual(suggestCorrections("Voy a ir", "Voy a Ir de"), []);

  // learnAlias: término nuevo
  let result = learnAlias([], { term: "Avinzano", alias: "Abinsano" });
  assert.equal(result.added, true);
  assert.deepEqual(result.dictionary, [{ term: "Avinzano", aliases: ["Abinsano"] }]);
  // Término existente: se añade el alias
  result = learnAlias(["Avinzano"], { term: "avinzano", alias: "Abinsano" });
  assert.equal(result.added, true);
  assert.deepEqual(result.dictionary, [{ term: "Avinzano", aliases: ["Abinsano"] }]);
  // Alias ya conocido
  result = learnAlias(result.dictionary, { term: "Avinzano", alias: "abinsano" });
  assert.equal(result.added, false);
  assert.equal(result.reason, "duplicate");
  // Inválido
  assert.equal(learnAlias([], { term: "", alias: "x" }).reason, "invalid");
  // Diccionario lleno
  const full = Array.from({ length: 200 }, (_, index) => `termino${index}`);
  assert.equal(learnAlias(full, { term: "Nuevo", alias: "nuebo" }).reason, "full");

  console.log("Word learning: 20 checks passed.");
}

run();
