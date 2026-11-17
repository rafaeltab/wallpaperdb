import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FactoryClient } from '../src/canvas/client';
import { useFactory } from '../src/canvas/use-factory';
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it('bounds hanging reads, counts failures and restores freshness on a successful read', async () => {
  vi.useFakeTimers();
  let healthy = false;
  const client = new FactoryClient(async () =>
    healthy ? new Response(null, { status: 304 }) : new Promise<Response>(() => {})
  );
  const { result, unmount } = renderHook(() => useFactory(client));
  await act(() => vi.advanceTimersByTimeAsync(3500));
  expect(result.current.activityRefresh.failures).toBe(1);
  expect(result.current.activityRefresh.lastSuccess).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(6000));
  expect(result.current.activityRefresh.failures).toBe(3);
  healthy = true;
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(result.current.activityRefresh.failures).toBe(0);
  const lastSuccess = result.current.activityRefresh.lastSuccess;
  expect(lastSuccess).toBeTypeOf('number');
  healthy = false;
  await act(() => vi.advanceTimersByTimeAsync(3500));
  expect(result.current.activityRefresh.lastSuccess).toBe(lastSuccess);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
it('ignores an earlier client lifetime completing after replacement', async () => {
  vi.useFakeTimers();
  let resolve: (response: Response) => void = () => {};
  const old = new FactoryClient(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      })
  );
  const replacement = new FactoryClient(async () => new Response(null, { status: 304 }));
  const { result, rerender } = renderHook(({ client }) => useFactory(client), {
    initialProps: { client: old },
  });
  rerender({ client: replacement });
  await act(() => vi.advanceTimersByTimeAsync(0));
  const at = result.current.activityRefresh.lastSuccess;
  await act(async () => {
    resolve(new Response('', { status: 503 }));
  });
  expect(result.current.activityRefresh).toEqual({ failures: 0, lastSuccess: at });
});
