import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchProfileByHandle, fetchProfileById } from '@/lib/graphql/profiles';

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

describe('Profile GraphQL client', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('performs an exact Handle lookup without rewriting the requested value', async () => {
    const profile = {
      id: 'user_ada',
      handle: 'ada-lovelace',
      displayName: 'Ada Lovelace',
      biographyMarkdown: '',
      picture: null,
      canonicalPath: '/profiles/@ada-lovelace',
    };
    mockFetch.mockResolvedValue(createGraphQLResponse({ profileByHandle: profile }));

    await expect(fetchProfileByHandle('Ada-Lovelace')).resolves.toEqual(profile);
    const [, init] = mockFetch.mock.calls[0] as [URL, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      operationName: 'GetProfileByHandle',
      variables: { handle: 'Ada-Lovelace' },
    });
  });

  it('performs an exact Profile ID lookup', async () => {
    const profile = {
      id: 'user_ada',
      handle: 'ada-lovelace',
      displayName: 'Ada Lovelace',
      biographyMarkdown: '',
      picture: null,
      canonicalPath: '/profiles/@ada-lovelace',
    };
    mockFetch.mockResolvedValue(createGraphQLResponse({ profile }));

    await expect(fetchProfileById('user_ada')).resolves.toEqual(profile);
    const [, init] = mockFetch.mock.calls[0] as [URL, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      operationName: 'GetProfile',
      variables: { id: 'user_ada' },
    });
  });
});
