import { expect, it } from 'vitest';
import {
  createItemDependencyLinkExecutor,
  type ItemDependencyLinkRequest,
} from '../src/canvas/item-dependency-link-executor';
import type {
  ItemDependencyLink,
  ItemDependencyLinkInput,
} from '../src/canvas/item-dependency-links';

class ControlledWorker extends EventTarget {
  requests: ItemDependencyLinkRequest[] = [];
  terminated = false;
  postMessage(request: ItemDependencyLinkRequest) {
    this.requests.push(request);
  }
  terminate() {
    this.terminated = true;
  }
  complete(index: number) {
    this.dispatchEvent(
      new MessageEvent('message', { data: { id: this.requests[index].id, links: [] } })
    );
  }
  progress(index: number, links: ItemDependencyLink[]) {
    this.dispatchEvent(
      new MessageEvent('message', { data: { id: this.requests[index].id, progress: links } })
    );
  }
}
const input: ItemDependencyLinkInput = { nodes: [], edges: [], width: 100, height: 100 };

it('bounds pending Project canvas work to the latest input while a calculation runs', async () => {
  const worker = new ControlledWorker();
  const executor = createItemDependencyLinkExecutor(() => worker);
  const first = executor.compute(input);
  const replaced = executor.compute({ ...input, width: 200 });
  const latest = executor.compute({ ...input, width: 300 });
  await expect(replaced).rejects.toMatchObject({ name: 'AbortError' });
  expect(worker.requests).toHaveLength(1);
  worker.complete(0);
  await expect(first).resolves.toEqual([]);
  expect(worker.requests[1].input.width).toBe(300);
  worker.complete(1);
  await expect(latest).resolves.toEqual([]);
  executor.dispose();
});

it('terminates worker ownership and rejects outstanding work when the Project canvas closes', async () => {
  const worker = new ControlledWorker();
  const executor = createItemDependencyLinkExecutor(() => worker);
  const result = executor.compute(input);
  executor.dispose();
  worker.complete(0);
  await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  expect(worker.terminated).toBe(true);
  await expect(executor.compute(input)).rejects.toThrow('disposed');
});

it('reports worker failures and rejects both running and queued inputs', async () => {
  const worker = new ControlledWorker();
  const executor = createItemDependencyLinkExecutor(() => worker);
  const running = executor.compute(input);
  const queued = executor.compute(input);
  worker.dispatchEvent(Object.assign(new Event('error'), { message: 'Worker failed' }));
  await Promise.all([
    expect(running).rejects.toThrow('Worker failed'),
    expect(queued).rejects.toThrow('Worker failed'),
  ]);
  expect(worker.terminated).toBe(true);
});

it('reports an unreadable worker result instead of leaving Project canvas work pending', async () => {
  const worker = new ControlledWorker();
  const executor = createItemDependencyLinkExecutor(() => worker);
  const result = executor.compute(input);
  worker.dispatchEvent(new Event('messageerror'));
  await expect(result).rejects.toThrow('could not be received');
  expect(worker.terminated).toBe(true);
});

const link: ItemDependencyLink = {
  source: 1,
  target: 2,
  key: '1-2',
  label: 'A',
  color: '#78cbb7',
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
  ],
  d: 'M0,0 L10,0',
  failed: false,
};

it('publishes append-only progress while retaining the running worker until final completion', async () => {
  const worker = new ControlledWorker();
  const executor = createItemDependencyLinkExecutor(() => worker);
  const batches: ItemDependencyLink[][] = [];
  const first = executor.compute(input, (links) => batches.push(links));
  const queued = executor.compute({ ...input, width: 200 });
  worker.progress(0, [link]);
  expect(batches).toEqual([[link]]);
  expect(worker.requests).toHaveLength(1);
  worker.complete(0);
  await expect(first).resolves.toEqual([]);
  expect(worker.requests).toHaveLength(2);
  worker.progress(0, [link]);
  expect(batches).toEqual([[link]]);
  worker.complete(1);
  await expect(queued).resolves.toEqual([]);
  executor.dispose();
});

it('keeps worker ownership consistent when a progress consumer throws', async () => {
  const worker = new ControlledWorker();
  const executor = createItemDependencyLinkExecutor(() => worker);
  const first = executor.compute(input, () => {
    throw new Error('Progress consumer failed');
  });
  const queued = executor.compute(input);
  worker.progress(0, [link]);
  await expect(first).rejects.toThrow('Progress consumer failed');
  worker.progress(0, [link]);
  worker.complete(0);
  expect(worker.requests).toHaveLength(2);
  worker.complete(1);
  await expect(queued).resolves.toEqual([]);
  executor.dispose();
});
