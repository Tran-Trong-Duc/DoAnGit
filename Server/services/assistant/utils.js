function withTimeout(promise, timeoutMs, fallback) {
  let timer = null;
  const guarded = Promise.resolve(promise).catch((err) => {
    console.log("Assistant task failed:", err.message);
    return fallback;
  });
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), timeoutMs);
  });
  return Promise.race([guarded, timeout]).finally(() => clearTimeout(timer));
}

module.exports = {
  withTimeout,
};
