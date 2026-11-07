import { observationRefreshIntervalMs } from '../capabilities/observe/index.js';

/** Composition owns metadata work independently of the HTTP request that asks for it. */
export function observationWorker(refresh: () => Promise<void>) {
  let clients = 0,
    activeUntil = 0,
    nextAt = 0,
    closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = undefined;
    if (closed || pending || (!clients && nextAt >= activeUntil)) return;
    timer = setTimeout(
      () => {
        timer = undefined;
        if (closed || (!clients && Date.now() >= activeUntil)) return;
        nextAt = Date.now() + observationRefreshIntervalMs;
        pending = refresh().finally(() => {
          pending = undefined;
          schedule();
        });
        void pending.catch(() => undefined);
      },
      Math.max(0, nextAt - Date.now())
    );
  };
  const demand = () => {
    if (closed) return;
    activeUntil = Date.now() + 30_000;
    schedule();
  };
  return {
    demand,
    client: () => {
      clients++;
      demand();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        clients--;
        schedule();
      };
    },
    close: async () => {
      closed = true;
      clearTimeout(timer);
      await pending?.catch(() => undefined);
    },
  };
}
