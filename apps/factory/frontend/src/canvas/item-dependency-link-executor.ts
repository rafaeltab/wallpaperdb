import type { ItemDependencyLink, ItemDependencyLinkInput } from './item-dependency-links';

export type ItemDependencyLinkRequest = { id: number; input: ItemDependencyLinkInput };
export type ItemDependencyLinkResponse =
  | { id: number; links: ItemDependencyLink[] }
  | { id: number; error: string };

export interface ItemDependencyLinkExecutor {
  compute(input: ItemDependencyLinkInput): Promise<ItemDependencyLink[]>;
  dispose(): void;
}

export type ItemDependencyLinkWorker = Pick<
  Worker,
  'postMessage' | 'terminate' | 'addEventListener'
>;

/** One running calculation and one latest queued input bound retained work during refresh bursts. */
export function createItemDependencyLinkExecutor(
  createWorker: () => ItemDependencyLinkWorker = () =>
    new Worker(new URL('./item-dependency-link-worker.ts', import.meta.url), { type: 'module' })
): ItemDependencyLinkExecutor {
  const worker = createWorker();
  let sequence = 0;
  let disposed = false;
  type Calculation = {
    id: number;
    input: ItemDependencyLinkInput;
    resolve: (links: ItemDependencyLink[]) => void;
    reject: (error: Error) => void;
  };
  let running: Calculation | undefined;
  let queued: Calculation | undefined;
  function dispatch(calculation: Calculation) {
    running = calculation;
    try {
      worker.postMessage({
        id: calculation.id,
        input: calculation.input,
      } satisfies ItemDependencyLinkRequest);
    } catch (error) {
      running = undefined;
      calculation.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }
  worker.addEventListener('message', (event: MessageEvent<ItemDependencyLinkResponse>) => {
    if (disposed || !running || event.data.id !== running.id) return;
    const complete = running;
    running = undefined;
    if ('error' in event.data) complete.reject(new Error(event.data.error));
    else complete.resolve(event.data.links);
    if (queued) {
      const next = queued;
      queued = undefined;
      dispatch(next);
    }
  });
  function fail(error: Error) {
    if (disposed) return;
    running?.reject(error);
    queued?.reject(error);
    running = queued = undefined;
    disposed = true;
    worker.terminate();
  }
  worker.addEventListener('error', (event: ErrorEvent) => {
    fail(new Error(event.message || 'Item dependency links unavailable'));
  });
  worker.addEventListener('messageerror', () => {
    fail(new Error('Item dependency link result could not be received'));
  });
  return {
    compute(input) {
      if (disposed) return Promise.reject(new Error('Item dependency link executor is disposed'));
      return new Promise((resolve, reject) => {
        const calculation = { id: ++sequence, input, resolve, reject };
        if (running) {
          queued?.reject(new DOMException('Replaced by a newer Project canvas', 'AbortError'));
          queued = calculation;
        } else dispatch(calculation);
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const error = new DOMException('Project canvas closed', 'AbortError');
      running?.reject(error);
      queued?.reject(error);
      running = queued = undefined;
      worker.terminate();
    },
  };
}
