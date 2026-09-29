import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfileRouteError, ProfileRoutePending, ProfileQueryStatus } from '@/components/profile/profile-route-state';
import { loadCanonicalProfile, redirectHandleToCanonical, redirectProfileIdToCanonical } from '@/lib/profile-route-loaders';

const profile = { id: 'user_ada', handle: 'ada', displayName: 'Ada', biographyMarkdown: '', picture: null, canonicalPath: '/profiles/@ada' };
const resolution = { profile, canonicalHandle: 'ada', requestedHandle: 'ada', isAlias: false };

function response(status: number) {
  return new Response(JSON.stringify({ errors: [{ message: 'private error' }] }), {
    status, headers: { 'content-type': 'application/json', 'retry-after': '0' },
  });
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Profile route admission states', () => {
  it.each([
    ['/profiles/@ada', 429], ['/profiles/@ada', 503],
    ['/profiles/ada', 429], ['/profiles/ada', 503],
    ['/profiles/id/user_ada', 429], ['/profiles/id/user_ada', 503],
  ] as const)('explains %s HTTP %s and retries through its loader', async (path, status) => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(response(status)));
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = new QueryClient();
    const root = createRootRoute();
    const common = { getParentRoute: () => root, errorComponent: ProfileRouteError, pendingComponent: ProfileRoutePending, pendingMs: 0, pendingMinMs: 0 };
    const canonical = createRoute({ ...common, path: '/profiles/@{$handle}', loader: ({ params }) => loadCanonicalProfile(client, params.handle), component: () => <p>Profile loaded</p> });
    const bare = createRoute({ ...common, path: '/profiles/$handle', loader: ({ params }) => redirectHandleToCanonical(client, params.handle) });
    const id = createRoute({ ...common, path: '/profiles/id/$profileId', loader: ({ params }) => redirectProfileIdToCanonical(client, params.profileId) });
    const router = createRouter({ routeTree: root.addChildren([canonical, bare, id]), history: createMemoryHistory({ initialEntries: [path] }) });
    const view = render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
    try {
      expect(await screen.findByRole('alert')).toHaveTextContent(status === 429 ? 'network' : 'busy');
      await waitFor(() => expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled());
      expect(fetch).toHaveBeenCalledTimes(status === 429 ? 2 : 1);
      fetch.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ data: { profileByHandle: resolution, profile } }), { headers: { 'content-type': 'application/json' } })));
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByText('Profile loaded')).toBeInTheDocument();
    } finally { view.unmount(); client.clear(); }
  });

  it('preserves cached Profile identity and exposes its failed refresh', async () => {
    const client = new QueryClient();
    client.setQueryData(['public-profile', 'handle', 'ada'], resolution);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(response(503))));
    const root = createRootRoute();
    const route = createRoute({ getParentRoute: () => root, path: '/profiles/@{$handle}', loader: ({ params }) => loadCanonicalProfile(client, params.handle), component: () => <><ProfileQueryStatus /><p>Ada remains visible</p></>, errorComponent: ProfileRouteError });
    const router = createRouter({ routeTree: root.addChildren([route]), history: createMemoryHistory({ initialEntries: ['/profiles/@ada'] }) });
    const view = render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
    try {
      expect(await screen.findByText('Ada remains visible')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('busy');
      expect(fetch).toHaveBeenCalledOnce();
    } finally { view.unmount(); client.clear(); }
  });
});
