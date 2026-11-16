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
  }[] = [];
  let disposed = false;
  const executor: ItemDependencyLinkExecutor = {
    compute(value) {
      return new Promise((resolve, reject) => requests.push({ input: value, resolve, reject }));
    },
    dispose() {
      disposed = true;
    },
  };
  return { requests, create: () => executor, disposed: () => disposed };
}

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
