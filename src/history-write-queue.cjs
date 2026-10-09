function createHistoryWriteQueue({ insert, trim, schedule = setImmediate, onError = () => {} }) {
  let queue = Promise.resolve();
  let pending = 0;

  function enqueue(text, limit, literal) {
    pending += 1;
    queue = queue.catch(() => {})
      .then(() => new Promise((resolve) => schedule(resolve)))
      .then(() => {
        const row = insert(text, literal);
        trim(limit);
        return row;
      })
      .catch(onError)
      .finally(() => { pending -= 1; });
    return true;
  }

  return { enqueue, flush: () => queue, pending: () => pending };
}

module.exports = { createHistoryWriteQueue };
