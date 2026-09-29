import { QueryClient, QueryObserver, focusManager, onlineManager } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { graphqlClient } from '@/lib/graphql/client';
import { GatewayAdmissionError, graphqlQueryOptions } from '@/lib/graphql/admission';

function denied(status: number, retryAfter = '2') {
  return new Response(JSON.stringify({ errors: [{ message: 'private infrastructure details' }] }), {
    status,
    headers: { 'content-type': 'application/json', 'retry-after': retryAfter },
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
});

describe('GraphQL admission errors', () => {
  it.each([429, 503])('normalizes HTTP %s without exposing response details', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(denied(status)));
    const error = await graphqlClient.request('{ hello }').catch((error: unknown) => error);
    expect(error).toBeInstanceOf(GatewayAdmissionError);
    expect(error).toMatchObject({ status, retryAfterMs: 2000 });
    expect(String(error)).not.toContain('private infrastructure');
    expect(String(error)).toContain(status === 429 ? 'network' : 'busy');
  });

  it.each([
    ['invalid', 60_000],
    ['-1', 60_000],
    ['0', 0],
    ['Tue, 29 Sep 2026 00:00:03 GMT', 3000],
  ])('handles Retry-After %s', async (header, delay) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-29T00:00:00Z'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(denied(429, header)));
    await expect(graphqlClient.request('{ hello }')).rejects.toMatchObject({ retryAfterMs: delay });
  });

  it('retries quota once after the advertised wait plus jitter and retains the second error', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(denied(429)));
    vi.stubGlobal('fetch', fetch);
    const client = new QueryClient();
    const result = client.fetchQuery({
      queryKey: ['quota'], queryFn: () => graphqlClient.request('{ hello }'), ...graphqlQueryOptions,
    }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toBeInstanceOf(GatewayAdmissionError);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    client.clear();
  });

  it.each([429, 503])('does not refresh a terminal HTTP %s on focus, reconnect, or remount; manual retry works', async (status) => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(denied(status, '0'))));
    const client = new QueryClient();
    client.mount();
    const options = { queryKey: ['admission'], queryFn: () => graphqlClient.request('{ hello }'), ...graphqlQueryOptions };
    const observer = new QueryObserver(client, options);
    let unsubscribe = observer.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(1000);
    const attempts = status === 429 ? 2 : 1;
    expect(fetch).toHaveBeenCalledTimes(attempts);
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    unsubscribe();
    unsubscribe = new QueryObserver(client, options).subscribe(() => {});
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetch).toHaveBeenCalledTimes(attempts);
    const retry = observer.refetch();
    await vi.advanceTimersByTimeAsync(1000);
    await retry;
    expect(fetch).toHaveBeenCalledTimes(attempts * 2);
    unsubscribe();
    client.unmount();
    client.clear();
  });
});
