import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RecentCreations } from '@/components/upload/recent-creations';

const auth = vi.hoisted(() => ({ userId: 'creator', isSignedIn: true }));
vi.mock('@clerk/react', () => ({ useAuth: () => auth }));
vi.mock('@/lib/auth/token-provider', () => ({ getAuthToken: async () => 'session-token' }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  auth.userId = 'creator';
});

for (const end of ['navigation', 'session replacement'] as const) {
  it(`aborts the actual list fetch on ${end}`, async () => {
    const signals: AbortSignal[] = [];
    let aborted = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        const signal = init.signal;
        if (!signal) throw new Error('Missing request lifetime');
        signals.push(signal);
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              aborted++;
              reject(new DOMException('Cancelled', 'AbortError'));
            },
            { once: true }
          );
        });
      })
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = () => (
      <QueryClientProvider client={client}>
        <RecentCreations />
      </QueryClientProvider>
    );
    const mounted = render(view());
    try {
      await waitFor(() => expect(signals).toHaveLength(1));
      expect(fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/wallpapers$/),
        expect.objectContaining({ signal: signals[0] })
      );
      if (end === 'navigation') mounted.unmount();
      else {
        auth.userId = 'replacement';
        mounted.rerender(view());
        await waitFor(() => expect(signals).toHaveLength(2));
        expect(signals[1]?.aborted).toBe(false);
      }
      await waitFor(() => expect(aborted).toBe(1));
      expect(signals[0]?.aborted).toBe(true);
    } finally {
      mounted.unmount();
      client.clear();
    }
  });
}
