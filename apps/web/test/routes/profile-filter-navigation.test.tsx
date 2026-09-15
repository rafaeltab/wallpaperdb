import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BrowseFilterPanelProvider,
  useBrowseFilterPanel,
} from '@/components/browse-filter-panel-context';
import { SearchBar } from '@/components/search-bar';
import { parseBrowseSearch } from '@/lib/browse-filters';
import { HomePage } from '@/routes/index';

function BrowseLayout() {
  const { isOpen, toggle } = useBrowseFilterPanel();
  return (
    <>
      <SearchBar showFilterToggle isFilterPanelOpen={isOpen} onToggleFilters={toggle} />
      <Outlet />
    </>
  );
}

interface GraphQLRequest {
  operationName: string;
  variables: Record<string, unknown>;
}

describe('Profile filter navigation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('carries a selected Profile ID through real navigation and wallpaper requests, then clears only ownership', async () => {
    const requests: GraphQLRequest[] = [];
    const profile = {
      id: 'user_Ada',
      handle: 'ada-lovelace',
      displayName: 'Ada Lovelace',
      picture: null,
      canonicalPath: '/profiles/@ada-lovelace',
      biographyMarkdown: '',
      version: 1,
    };
    const pageInfo = { hasNextPage: false, hasPreviousPage: false, endCursor: null };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const request: GraphQLRequest = JSON.parse(String(init.body));
        requests.push({ operationName: request.operationName, variables: request.variables });
        const data =
          request.operationName === 'SearchProfiles'
            ? { searchProfiles: { edges: [{ node: profile }], pageInfo } }
            : request.operationName === 'GetProfile'
              ? { profile }
              : { searchWallpapers: { edges: [], pageInfo } };
        return new Response(JSON.stringify({ data }), {
          headers: { 'content-type': 'application/json' },
        });
      })
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const rootRoute = createRootRoute({
      component: () => (
        <BrowseFilterPanelProvider>
          <BrowseLayout />
        </BrowseFilterPanelProvider>
      ),
    });
    const browseRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: HomePage,
      validateSearch: parseBrowseSearch,
    });
    const history = createMemoryHistory({ initialEntries: ['/?format=png&after=old_cursor'] });
    const router = createRouter({ routeTree: rootRoute.addChildren([browseRoute]), history });
    const user = userEvent.setup();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    );
    try {
      await user.click(await screen.findByRole('button', { name: 'Toggle filters' }));
      await user.type(await screen.findByRole('searchbox', { name: 'Profile' }), 'countess');
      await user.click(
        await screen.findByRole('button', { name: 'Select Ada Lovelace (@ada-lovelace)' })
      );

      await waitFor(() =>
        expect(router.state.location.search).toEqual({
          format: 'png',
          profileId: 'user_Ada',
        })
      );
      await waitFor(() =>
        expect(requests).toContainEqual({
          operationName: 'SearchWallpapers',
          variables: {
            first: 20,
            after: null,
            filter: { variants: { format: 'image/png' }, profileId: 'user_Ada' },
          },
        })
      );
      expect(requests).toContainEqual({
        operationName: 'SearchProfiles',
        variables: { query: 'countess', first: 10, after: null },
      });
      expect(await screen.findByText('@ada-lovelace')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Toggle filters' }));
      await user.click(screen.getByRole('button', { name: 'Clear Profile filter' }));
      await waitFor(() => expect(router.state.location.search).toEqual({ format: 'png' }));
      await waitFor(() =>
        expect(requests.at(-1)).toEqual({
          operationName: 'SearchWallpapers',
          variables: { first: 20, after: null, filter: { variants: { format: 'image/png' } } },
        })
      );
    } finally {
      view.unmount();
      queryClient.clear();
    }
  });
});
