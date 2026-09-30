import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { parseBrowseSearch } from '@/lib/browse-filters';
import { Route as RootRoute } from '@/routes/__root';
import { HomePage } from '@/routes/index';

vi.mock('@/components/user-menu', () => ({ UserMenu: () => null }));
vi.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));
vi.mock('@/components/upload/upload-queue-toast-manager', () => ({ UploadQueueToastManager: () => null }));
vi.mock('@tanstack/router-devtools', () => ({ TanStackRouterDevtools: () => null }));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each(['header Home', 'sidebar Browse'] as const)(
  'cancels a pending picker color when the %s link clears browse search',
  async (link) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    data: {
      searchWallpapers: {
        edges: [],
        pageInfo: { hasNextPage: false, hasPreviousPage: false, endCursor: null },
      },
    },
  }), { headers: { 'content-type': 'application/json' } })));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const browseRoute = createRoute({
    getParentRoute: () => RootRoute,
    path: '/',
    component: HomePage,
    validateSearch: parseBrowseSearch,
  });
  const router = createRouter({
    routeTree: RootRoute.addChildren([browseRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: { queryClient },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );

  try {
    fireEvent.click(await screen.findByRole('button', { name: 'Toggle filters' }));
    vi.useFakeTimers();
    fireEvent.input(screen.getByLabelText('Color'), { target: { value: '#00ff00' } });
    fireEvent.click(link === 'header Home'
      ? within(screen.getByRole('banner')).getByRole('link', { name: 'WallpaperDB' })
      : screen.getByRole('link', { name: 'Browse' }));

    await act(async () => { await vi.advanceTimersByTimeAsync(300); });

    expect(router.state.location.search).toEqual({});
    expect(screen.getByLabelText('Color')).toHaveValue('#ffffff');
  } finally {
    view.unmount();
    queryClient.clear();
  }
  }
);
