import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useItemDependencyLinks } from '../src/canvas/use-item-dependency-links';
import type {
  ItemDependencyLink,
  ItemDependencyLinkInput,
} from '../src/canvas/item-dependency-links';
import type { ItemDependencyLinkExecutor } from '../src/canvas/item-dependency-link-executor';

afterEach(cleanup);
const input: ItemDependencyLinkInput = { nodes: [], edges: [], width: 100, height: 100 };
function controlled() {
  const requests: {
    input: ItemDependencyLinkInput;
    resolve: (links: ItemDependencyLink[]) => void;
    reject: (error: Error) => void;
    progress?: (links: ItemDependencyLink[]) => void;
  }[] = [];
  let disposed = false;
  const executor: ItemDependencyLinkExecutor = {
    compute(value, progress?: (links: ItemDependencyLink[]) => void) {
      return new Promise((resolve, reject) =>
        requests.push({ input: value, resolve, reject, progress })
      );
    },
    dispose() {
      disposed = true;
    },
  };
  return { requests, create: () => executor, disposed: () => disposed };
}

const linked: ItemDependencyLinkInput = {
  width: 600,
  height: 600,
  nodes: [
    { id: 1, x: 0, y: 0, width: 100, height: 40 },
    { id: 2, x: 200, y: 0, width: 100, height: 40 },
    { id: 3, x: 500, y: 500, width: 40, height: 40 },
  ],
  edges: [{ source: 1, target: 2 }],
};
const link: ItemDependencyLink = {
  source: 1,
  target: 2,
  key: '1-2',
  label: 'A',
  color: '#78cbb7',
  d: 'M100,20 L120,20 L120,80 L250,80 L250,40',
  points: [
    { x: 100, y: 20 },
    { x: 120, y: 20 },
    { x: 120, y: 80 },
    { x: 250, y: 80 },
    { x: 250, y: 40 },
  ],
  failed: false,
};

it('publishes completed link batches before the final result and ignores obsolete progress', async () => {
  const worker = controlled();
  const { result, rerender } = renderHook(
    ({ value }) => useItemDependencyLinks(value, worker.create),
    { initialProps: { value: linked } }
  );
  await act(async () => worker.requests[0].progress?.([link]));
  expect(result.current.links).toEqual([link]);
  expect(result.current.pending).toBe(true);
  rerender({ value: { ...linked, edges: [] } });
  expect(result.current.links).toEqual([]);
  await act(async () => worker.requests[0].progress?.([link]));
  expect(result.current.links).toEqual([]);
  await act(async () => worker.requests[1].resolve([]));
  await act(async () => worker.requests[0].resolve([link]));
  expect(result.current.links).toEqual([]);
  expect(result.current.pending).toBe(false);
});

it('retains an unchanged visible link while unrelated geometry is pending, including equal worker results', async () => {
  const worker = controlled();
  const { result, rerender } = renderHook(
    ({ value }) => useItemDependencyLinks(value, worker.create),
    { initialProps: { value: linked } }
  );
  await act(async () => worker.requests[0].resolve([link]));
  const before = result.current.links[0];
  rerender({
    value: {
      ...linked,
      nodes: linked.nodes.map((node) => (node.id === 3 ? { ...node, y: 550 } : node)),
    },
  });
  expect(result.current.links[0]).toBe(before);
  expect(result.current.pending).toBe(true);
  await act(async () => worker.requests[1].progress?.([structuredClone(link)]));
  expect(result.current.links[0]).toBe(before);
  await act(async () => worker.requests[1].resolve([structuredClone(link)]));
  expect(result.current.links[0]).toBe(before);
  expect(result.current.pending).toBe(false);
});

it.each(['endpoint', 'obstacle', 'terminal fan', 'dependency'] as const)(
  'immediately hides an old link when its %s changes',
  async (change) => {
    const worker = controlled();
    const { result, rerender } = renderHook(
      ({ value }) => useItemDependencyLinks(value, worker.create),
      { initialProps: { value: linked } }
    );
    await act(async () => worker.requests[0].resolve([link]));
    const next: ItemDependencyLinkInput =
      change === 'endpoint'
        ? {
            ...linked,
            nodes: linked.nodes.map((node) => (node.id === 1 ? { ...node, x: 10 } : node)),
          }
        : change === 'obstacle'
          ? {
              ...linked,
              nodes: linked.nodes.map((node) =>
                node.id === 3 ? { ...node, x: 150, y: 60 } : node
              ),
            }
          : {
              ...linked,
              edges: change === 'terminal fan' ? [...linked.edges, { source: 1, target: 3 }] : [],
            };
    rerender({ value: next });
    expect(result.current.links).toEqual([]);
    expect(result.current.pending).toBe(true);
    await act(async () => worker.requests[0].progress?.([link]));
    expect(result.current.links).toEqual([]);
  }
);

it('publishes only the latest Project canvas generation even if older calculations finish later', async () => {
  const worker = controlled();
  const { result, rerender } = renderHook(
    ({ value }) => useItemDependencyLinks(value, worker.create),
    { initialProps: { value: input } }
  );
  const next = { ...input, width: 200 };
  rerender({ value: next });
  await act(async () => {
    worker.requests[1].resolve([]);
  });
  expect(result.current.input).toBe(next);
  await act(async () => {
    worker.requests[0].resolve([]);
  });
  expect(result.current.input).toBe(next);
  expect(result.current.pending).toBe(false);
});

it('retains the completed geometry with its links while a replacement is pending or fails', async () => {
  const worker = controlled();
  const { result, rerender } = renderHook(
    ({ value }) => useItemDependencyLinks(value, worker.create),
    { initialProps: { value: input } }
  );
  await act(async () => {
    worker.requests[0].resolve([]);
  });
  rerender({ value: { ...input, width: 200 } });
  expect(result.current.input).toBe(input);
  expect(result.current.pending).toBe(true);
  await act(async () => {
    worker.requests[1].reject(new Error('Unavailable'));
  });
  expect(result.current.input).toBe(input);
  expect(result.current.error?.message).toBe('Unavailable');
  expect(result.current.pending).toBe(false);
});

it('disposes worker ownership and ignores late results after unmount', async () => {
  const worker = controlled();
  const { result, unmount } = renderHook(() => useItemDependencyLinks(input, worker.create));
  unmount();
  await act(async () => {
    worker.requests[0].resolve([]);
  });
  expect(worker.disposed()).toBe(true);
  expect(result.current.input).toBeUndefined();
});

it('reports unavailable worker support without performing routing on the main thread', () => {
  const unavailable = () => {
    throw new Error('Worker unavailable');
  };
  const { result, rerender } = renderHook(
    ({ value }) => useItemDependencyLinks(value, unavailable),
    { initialProps: { value: input } }
  );
  expect(result.current.error?.message).toBe('Worker unavailable');
  expect(result.current.links).toEqual([]);
  rerender({ value: { ...input, width: 200 } });
  expect(result.current.error?.message).toBe('Worker unavailable');
  expect(result.current.pending).toBe(false);
});
