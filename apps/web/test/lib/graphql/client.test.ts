import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearTokenProvider, setTokenProvider } from '@/lib/auth/token-provider';
import { graphqlClient } from '@/lib/graphql/client';

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

    mockFetch.mockResolvedValueOnce(
      createGraphQLResponse({ wallpapers: { edges: [] } })
    );

    await graphqlClient.request('{ wallpapers { edges { node { wallpaperId } } } }');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-jwt-token');
  });

  it('does not include Authorization header when no token provider is set', async () => {
    clearTokenProvider();

    mockFetch.mockResolvedValueOnce(
      createGraphQLResponse({ wallpapers: { edges: [] } })
    );

    await graphqlClient.request('{ wallpapers { edges { node { wallpaperId } } } }');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('does not include Authorization header when token provider returns null', async () => {
    setTokenProvider(async () => null);

    mockFetch.mockResolvedValueOnce(
      createGraphQLResponse({ wallpapers: { edges: [] } })
    );

    await graphqlClient.request('{ wallpapers { edges { node { wallpaperId } } } }');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('uses refreshed token on subsequent requests', async () => {
    let callCount = 0;
    setTokenProvider(async () => {
      callCount++;
      return callCount === 1 ? 'first-token' : 'second-token';
    });

    mockFetch.mockResolvedValueOnce(
      createGraphQLResponse({ wallpapers: { edges: [] } })
    );
    await graphqlClient.request('{ wallpapers { edges { node { wallpaperId } } } }');
    const [, init1] = mockFetch.mock.calls[0];
    expect((init1 as RequestInit).headers).toHaveProperty('Authorization', 'Bearer first-token');

    mockFetch.mockResolvedValueOnce(
      createGraphQLResponse({ wallpapers: { edges: [] } })
    );
    await graphqlClient.request('{ wallpapers { edges { node { wallpaperId } } } }');
    const [, init2] = mockFetch.mock.calls[1];
    expect((init2 as RequestInit).headers).toHaveProperty('Authorization', 'Bearer second-token');
  });
});