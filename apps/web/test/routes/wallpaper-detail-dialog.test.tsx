import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Wallpaper } from '@/lib/graphql/types';
import { WallpaperDetailPage } from '@/routes/wallpapers.$wallpaperId';

const wallpaper: Wallpaper = {
  wallpaperId: 'wlpr_dialog',
  profileId: 'user_contributor',
  variants: [
    {
      width: 1920,
      height: 1080,
      aspectRatio: 16 / 9,
      format: 'image/webp',
      fileSizeBytes: 1024,
      createdAt: '2026-03-01T00:00:00.000Z',
      url: 'https://media.example/wallpaper.webp',
    },
  ],
  uploadedAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-03-01T00:00:00.000Z',
};

describe('Wallpaper detail dialog', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('opens a named, described metadata dialog after loading and preserves keyboard dismissal', async () => {
    localStorage.clear();
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
    let respond: (response: Response) => void = () => {};
    const pendingResponse = new Promise<Response>((resolve) => { respond = resolve; });
    vi.stubGlobal('fetch', vi.fn(() => pendingResponse));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const rootRoute = createRootRoute();
    const detailRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/wallpapers/$wallpaperId',
      component: WallpaperDetailPage,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([detailRoute]),
      history: createMemoryHistory({ initialEntries: ['/wallpapers/wlpr_dialog'] }),
    });
    const user = userEvent.setup();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    );
    try {
      expect(await screen.findByRole('status', { name: 'Loading wallpaper details' })).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      respond(new Response(JSON.stringify({ data: { getWallpaper: wallpaper } }), {
        headers: { 'content-type': 'application/json' },
      }));

      const dialog = await screen.findByRole('dialog', { name: 'Wallpaper Details' });
      expect(dialog).toHaveAccessibleDescription('Wallpaper information, contributor, and available variants.');
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      await user.keyboard('i');
      expect(await screen.findByRole('dialog', { name: 'Wallpaper Details' })).toHaveAccessibleDescription(
        'Wallpaper information, contributor, and available variants.'
      );
    } finally {
      view.unmount();
      queryClient.clear();
    }
  });
});
