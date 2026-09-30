import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { parseBrowseSearch } from '@/lib/browse-filters';
import { Route as RootRoute } from '@/routes/__root';
import { HomePage } from '@/routes/index';

vi.mock('@/components/user-menu', () => ({ UserMenu: () => null }));
vi.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));
vi.mock('@/components/upload/upload-queue-toast-manager', () => ({ UploadQueueToastManager: () => null }));
vi.mock('@tanstack/router-devtools', () => ({ TanStackRouterDevtools: () => null }));

function renderNavigation(initialEntry: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: {
            searchWallpapers: {
              edges: [],
              pageInfo: { hasNextPage: false, hasPreviousPage: false, endCursor: null },
            },
          },
        }),
        { headers: { 'content-type': 'application/json' } }
      )
    )
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const browseRoute = createRoute({
    getParentRoute: () => RootRoute,
    path: '/',
    component: HomePage,
    validateSearch: parseBrowseSearch,
  });
  const wallpaperRoute = createRoute({
    getParentRoute: () => RootRoute,
    path: '/wallpapers/$wallpaperId',
    component: () => <div>Wallpaper detail</div>,
  });
  const router = createRouter({
    routeTree: RootRoute.addChildren([browseRoute, wallpaperRoute]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
    context: { queryClient },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );

  return {
    router,
    dispose: () => {
      view.unmount();
      queryClient.clear();
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each(['header Home', 'sidebar Browse'] as const)(
  'discards an unfinished modal color when the %s link clears browse search',
  async (link) => {
    const { router, dispose } = renderNavigation('/');

    try {
      fireEvent.click(await screen.findByRole('button', { name: 'Toggle filters' }));
      const homeLink = link === 'header Home'
        ? within(screen.getByRole('banner')).getByRole('link', { name: 'WallpaperDB' })
        : screen.getByRole('link', { name: 'Browse' });
      fireEvent.click(screen.getByRole('button', { name: 'Add color or feature' }));
      fireEvent.change(screen.getByRole('textbox', { name: 'Hex color' }), { target: { value: '#00ff00' } });
      fireEvent.click(homeLink);

      await waitFor(() => expect(router.state.location.search).toEqual({}));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(screen.queryByRole('button', { name: 'Edit #00FF00' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Add color or feature' }));
      expect(screen.getByRole('textbox', { name: 'Hex color' })).toHaveValue('#5D80D6');
    } finally {
      dispose();
    }
  }
);

it('restores the selected color when Back remounts browse after a Home link visit', async () => {
  const { router, dispose } = renderNavigation('/?color=%23FF0000');

  try {
    fireEvent.click(await screen.findByRole('button', { name: 'Toggle filters' }));
    expect(screen.getByRole('button', { name: 'Edit #FF0000' })).toBeInTheDocument();

    await act(async () => {
      await router.navigate({
        to: '/wallpapers/$wallpaperId',
        params: { wallpaperId: 'wallpaper_1' },
      });
    });
    expect(await screen.findByText('Wallpaper detail')).toBeInTheDocument();

    fireEvent.click(
      within(screen.getByRole('banner')).getByRole('link', { name: 'WallpaperDB' })
    );
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    expect(await screen.findByRole('button', { name: 'Add color or feature' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit #FF0000' })).not.toBeInTheDocument();

    await act(async () => {
      router.history.back();
    });
    expect(await screen.findByText('Wallpaper detail')).toBeInTheDocument();
    await act(async () => {
      router.history.back();
    });
    await waitFor(() => expect(router.state.location.search).toEqual({ color: '#FF0000' }));
    expect(await screen.findByRole('button', { name: 'Edit #FF0000' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit #FF0000' }));
    expect(screen.getByRole('textbox', { name: 'Hex color' })).toHaveValue('#FF0000');
  } finally {
    dispose();
  }
});
