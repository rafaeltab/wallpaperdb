import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
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

function queryClientReturning(
  value: unknown,
  field: 'profileByHandle' | 'profile' = 'profileByHandle'
): QueryClient {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(createGraphQLResponse({ [field]: value }))
  );
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

async function expectCanonicalRedirect(promise: Promise<unknown>) {
  try {
    await promise;
    throw new Error('Expected the loader to redirect');
  } catch (error) {
    expect(error).toBeInstanceOf(Response);
    expect((error as Response).status).toBe(307);
    expect((error as Response).headers.get('location')).toBe('/profiles/@ada-lovelace');
  }
}

describe('Profile route loaders', () => {
  it('rechecks an eventually consistent Handle after a cached miss', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(createGraphQLResponse({ profileByHandle: null }))
      .mockResolvedValueOnce(createGraphQLResponse({ profileByHandle: profile }));
    vi.stubGlobal('fetch', mockFetch);

    await expect(loadCanonicalProfile(queryClient, 'ada-lovelace')).rejects.toMatchObject({
      isNotFound: true,
    });
    await expect(loadCanonicalProfile(queryClient, 'ada-lovelace')).resolves.toEqual(profile);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('throws route not-found when a canonical Handle lookup has no result', async () => {
    await expect(loadCanonicalProfile(queryClientReturning(null), 'unknown')).rejects.toMatchObject({
      isNotFound: true,
    });
  });

  it('returns a current Profile from its canonical Handle', async () => {
    await expect(
      loadCanonicalProfile(queryClientReturning(profile), 'ada-lovelace'),
    ).resolves.toEqual(profile);
  });

  it('redirects a mismatched Handle response to the returned canonical Profile', async () => {
    await expectCanonicalRedirect(loadCanonicalProfile(queryClientReturning(profile), 'ada'));
  });

  it('redirects a bare Handle to the canonical route', async () => {
    await expectCanonicalRedirect(
      redirectHandleToCanonical(queryClientReturning(profile), 'ada-lovelace'),
    );
  });

  it('redirects a Profile ID to the canonical route', async () => {
    await expectCanonicalRedirect(
      redirectProfileIdToCanonical(queryClientReturning(profile, 'profile'), 'user_ada'),
    );
  });

  it.each([
    ['Handle', () => redirectHandleToCanonical(queryClientReturning(null), 'unknown')],
    [
      'Profile ID',
      () => redirectProfileIdToCanonical(queryClientReturning(null, 'profile'), 'user_unknown'),
    ],
  ])('throws route not-found for an unknown %s', async (_label, load) => {
    await expect(load()).rejects.toMatchObject({ isNotFound: true });
  });
});

function createGraphQLResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ data }),
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(JSON.stringify({ data })),
  };
}
