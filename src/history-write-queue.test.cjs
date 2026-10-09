const assert = require("node:assert/strict");
const { createHistoryWriteQueue } = require("./history-write-queue.cjs");

(async () => {
  const calls = [];
  const scheduled = [];
  const queue = createHistoryWriteQueue({
    insert: (text) => calls.push(["insert", text]),
    trim: (limit) => calls.push(["trim", limit]),
    schedule: (callback) => scheduled.push(callback)
  });
  queue.enqueue("uno", 30);
  assert.equal(queue.pending(), 1);
  assert.deepEqual(calls, []);
  while (!scheduled.length) await Promise.resolve();
  scheduled.shift()();
  await queue.flush();
  assert.deepEqual(calls, [["insert", "uno"], ["trim", 30]]);
  assert.equal(queue.pending(), 0);

  const literalCalls = [];
  const literalScheduled = [];
  const literalQueue = createHistoryWriteQueue({
    insert: (text, literal) => literalCalls.push([text, literal]),
    trim: () => {},
    schedule: (callback) => literalScheduled.push(callback)
  });
  literalQueue.enqueue("Hola.", 30, "eh hola");
  while (!literalScheduled.length) await Promise.resolve();
  literalScheduled.shift()();
  await literalQueue.flush();
  assert.deepEqual(literalCalls, [["Hola.", "eh hola"]], "el literal llega a la inserción");
  console.log("History write queue: 6 checks passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
