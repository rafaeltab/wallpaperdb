/** Dedicated jobs are stopped by Worker.terminate; only UI work needs timer yielding. */
export function yieldPictureWork(signal: AbortSignal, dedicatedWorker = false): Promise<void> {
  signal.throwIfAborted();
  if (dedicatedWorker) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('Picture processing cancelled.', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, 0);
    signal.addEventListener('abort', abort, { once: true });
  });
}
