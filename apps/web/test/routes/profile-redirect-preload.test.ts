import { QueryClient } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadCanonicalProfile,
  redirectHandleToCanonical,
  redirectProfileIdToCanonical,
} from '@/lib/profile-route-loaders';

const profile = {
  id: 'user_ada',
  handle: 'ada-lovelace',
  displayName: 'Ada Lovelace',
  biographyMarkdown: '',
  picture: null,
  canonicalPath: '/profiles/@ada-lovelace',
};

describe('Profile redirect preloading', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    ['Profile ID', { to: '/profiles/id/$profileId', params: { profileId: profile.id } }],
    ['bare Handle', { to: '/profiles/$handle', params: { handle: profile.handle } }],
    ['Handle alias', { to: '/profiles/@{$handle}', params: { handle: 'ada-original' } }],
  ] as const)('preloads a %s to its canonical Profile repeatedly under /web', async (_label, destination) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const request: { variables: { handle?: string } } = JSON.parse(String(init.body));
        return new Response(
          JSON.stringify({
            data: {
              profile,
              profileByHandle: {
                profile,
                requestedHandle: request.variables.handle,
                canonicalHandle: profile.handle,
                isAlias: request.variables.handle !== profile.handle,
              },
            },
          }),
          { headers: { 'content-type': 'application/json' } }
        );
      })
    );
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
    });
    let loaderCalls = 0;
    function boundedLoad<T>(load: () => Promise<T>): Promise<T> {
      // An href-only preload redirect can starve timers with recursive microtasks.
      // Bound loader calls so a regression fails without freezing the test worker.
      if (++loaderCalls > 8) throw new Error('Profile preload redirect loop');
      return load();
    }
    const root = createRootRoute();
    const settings = createRoute({ getParentRoute: () => root, path: '/settings/profile' });
    const byId = createRoute({
      getParentRoute: () => root,
      path: '/profiles/id/$profileId',
      loader: ({ params }) =>
        boundedLoad(() => redirectProfileIdToCanonical(queryClient, params.profileId)),
    });
    const byHandle = createRoute({
      getParentRoute: () => root,
      path: '/profiles/$handle',
      loader: ({ params }) =>
        boundedLoad(() => redirectHandleToCanonical(queryClient, params.handle)),
    });
    const canonical = createRoute({
      getParentRoute: () => root,
      path: '/profiles/@{$handle}',
      loader: ({ params }) => boundedLoad(() => loadCanonicalProfile(queryClient, params.handle)),
    });
    const router = createRouter({
      routeTree: root.addChildren([settings, byId, byHandle, canonical]),
      history: createMemoryHistory({ initialEntries: ['/web/settings/profile'] }),
      basepath: '/web',
      defaultPreload: 'intent',
    });
    try {
      await router.load();
      for (let visit = 0; visit < 2; visit++) {
        const matches = await router.preloadRoute(destination);
        expect(errors).not.toHaveBeenCalled();
        const canonicalMatch = matches?.at(-1);
        expect(canonicalMatch).toMatchObject({
          routeId: '/profiles/@{$handle}',
          params: { handle: profile.handle },
        });
        expect(router.getMatch(canonicalMatch?.id ?? '')).toMatchObject({
          status: 'success',
          loaderData: profile,
        });
      }
      expect(router.state.location.publicHref).toBe('/web/settings/profile');
    } finally {
      router.clearCache();
      queryClient.clear();
    }
  });
});
