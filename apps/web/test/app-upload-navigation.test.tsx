import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { getToken } = vi.hoisted(() => ({ getToken: vi.fn(async () => 'test-token') }));

vi.mock('@clerk/react', () => ({
  ClerkProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({ getToken, isLoaded: true, isSignedIn: true, userId: 'user_navigation' }),
  useClerk: () => ({ signOut: vi.fn() }),
  useUser: () => ({ user: { fullName: 'Navigation User', primaryEmailAddress: null } }),
}));
vi.mock('@tanstack/react-query-devtools', () => ({ ReactQueryDevtools: () => null }));
vi.mock('@tanstack/router-devtools', () => ({ TanStackRouterDevtools: () => null }));

describe('App upload notification navigation', () => {
  afterEach(() => {
    act(() => toast.dismiss());
    cleanup();
    vi.unstubAllGlobals();
  });

  it('returns from Browse to an in-progress upload through its notification in the production provider tree', async () => {
    const basePath = (import.meta.env.VITE_BASE_PATH || '').replace(/\/$/, '');
    window.history.replaceState({}, '', `${basePath}/upload`);
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }));
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/upload')) return new Promise<Response>(() => {});
      const body = url.endsWith('/profile/me/ensure') ? {
        id: 'user_navigation',
        handle: 'navigation-user',
        displayName: 'Navigation User',
        biographyMarkdown: '',
        pictureAssetId: null,
        version: 1,
        createdAt: '2026-09-26T00:00:00.000Z',
        updatedAt: '2026-09-26T00:00:00.000Z',
      } : {
        data: { searchWallpapers: { edges: [], pageInfo: { hasNextPage: false, hasPreviousPage: false } } },
      };
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    }));
    const { default: App } = await import('../src/App');
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText('Upload Wallpapers');
    await user.upload(screen.getByTestId('file-input'), new File(['picture'], 'wallpaper.jpg', { type: 'image/jpeg' }));
    const notifications = screen.getByRole('region', { name: /Notifications/ });
    await within(notifications).findByText('Uploading 0/1 files');
    await user.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
    await user.click(screen.getByRole('link', { name: 'Browse', exact: true }));
    await screen.findByText('No wallpapers found. Upload your first one!');
    expect(window.location.pathname).toBe(`${basePath}/`);

    await user.click(within(notifications).getByText('Uploading 0/1 files'));
    await waitFor(() => expect(window.location.pathname).toBe(`${basePath}/upload`));
    expect(await screen.findByText('Upload Wallpapers')).toBeInTheDocument();
    expect(screen.getByText('wallpaper.jpg')).toBeInTheDocument();
  });
});
