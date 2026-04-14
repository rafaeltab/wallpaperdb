import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearTokenProvider, setTokenProvider } from '@/lib/auth/token-provider';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function createGraphQLResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ data }),
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(JSON.stringify({ data })),
  };
}

describe('graphqlClient auth middleware', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    clearTokenProvider();
  });

  it('includes Authorization header when token is available', async () => {
    setTokenProvider(async () => 'test-jwt-token');

    const { graphqlClient } = await import('@/lib/graphql/client');

    mockFetch.mockResolvedValueOnce(
      createGraphQLResponse({ wallpapers: { edges: [] } })
    );

    await graphqlClient.request('{ wallpapers { edges { node { wallpaperId } } } }');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const request = mockFetch.mock.calls[0][1] as RequestInit;
    const headers = request.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-jwt-token');
  });

  it('does not include Authorization header when no token provider is set', async () => {
    clearTokenProvider();

    vi.resetModules();
    const { graphqlClient } = await import('@/lib/graphql/client');

    mockFetch.mockResolvedValueOnce(
      createGraphQLResponse({ wallpapers: { edges: [] } })
    );

    await graphqlClient.request('{ wallpapers { edges { node { wallpaperId } } } }');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const request = mockFetch.mock.calls[0][1] as RequestInit;
    const headers = request.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('does not include Authorization header when token provider returns null', async () => {
    setTokenProvider(async () => null);

    const { graphqlClient } = await import('@/lib/graphql/client');

    mockFetch.mockResolvedValueOnce(
      createGraphQLResponse({ wallpapers: { edges: [] } })
    );

    await graphqlClient.request('{ wallpapers { edges { node { wallpaperId } } } }');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const request = mockFetch.mock.calls[0][1] as RequestInit;
    const headers = request.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });
});