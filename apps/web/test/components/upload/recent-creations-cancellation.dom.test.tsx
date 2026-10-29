import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RecentCreations } from '@/components/upload/recent-creations';

const session = vi.hoisted(() => ({ userId: 'owner-a', isSignedIn: true }));
vi.mock('@clerk/react', () => ({ useAuth: () => session }));
vi.mock('@/lib/auth/token-provider', () => ({ getAuthToken: async () => 'owner-token' }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it.each(['navigation', 'session'] as const)(
  'cancels the actual pending list fetch on %s replacement',
  async (ending) => {
    session.userId = 'owner-a';
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, options: RequestInit) => {
        const signal = options.signal;
        if (!signal) throw new Error('List request must have a lifetime');
        signals.push(signal);
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true }
          );
        });
      })
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const element = (
      <QueryClientProvider client={client}>
        <RecentCreations />
      </QueryClientProvider>
    );
    const view = render(element);
    try {
      await waitFor(() => expect(signals).toHaveLength(1));
      expect(signals[0]?.aborted).toBe(false);
      if (ending === 'navigation') view.unmount();
      else {
        session.userId = 'owner-b';
        view.rerender(
          <QueryClientProvider client={client}>
            <RecentCreations />
          </QueryClientProvider>
        );
        await waitFor(() => expect(signals).toHaveLength(2));
        expect(signals[1]?.aborted).toBe(false);
      }
      await waitFor(() => expect(signals[0]?.aborted).toBe(true));
    } finally {
      view.unmount();
      client.clear();
    }
  }
);
