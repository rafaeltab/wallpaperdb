import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUserApiClient, UserApiError } from '@/lib/api/user';

const profile = {
  id: 'user_123',
  handle: 'wallpaper-fan',
  displayName: 'Wallpaper Fan',
  biographyMarkdown: '',
  pictureAssetId: null,
  version: 1,
  createdAt: '2026-07-12T12:00:00.000Z',
  updatedAt: '2026-07-12T12:00:00.000Z',
};

describe('User API client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts ensure with a fresh Clerk token and returns the authoritative Profile', async () => {
    const tokenProvider = vi.fn().mockResolvedValue('clerk-token');
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(profile), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetch);
    const client = createUserApiClient({ baseUrl: 'https://user.example.test/', tokenProvider });

    await expect(client.ensureProfile()).resolves.toEqual(profile);
    expect(tokenProvider).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('https://user.example.test/profile/me/ensure', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer clerk-token',
      },
      signal: undefined,
    });
  });

  it('does not send an ensure request without an auth token', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const client = createUserApiClient({ baseUrl: '/user', tokenProvider: async () => null });

    await expect(client.ensureProfile()).rejects.toMatchObject({
      name: 'UserApiError',
      status: 401,
      message: 'Authentication token is not ready',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('exposes the response status and service error detail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: 'Clerk is unavailable' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    const client = createUserApiClient({ baseUrl: '/user', tokenProvider: async () => 'token' });

    const error = await client.ensureProfile().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(UserApiError);
    expect(error).toMatchObject({ status: 503, message: 'Clerk is unavailable' });
  });

  it('rejects malformed and cross-User Profile responses', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'user_123' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(profile), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const client = createUserApiClient({ baseUrl: '/user', tokenProvider: async () => 'token' });

    await expect(client.ensureProfile()).rejects.toMatchObject({ status: 502 });
    await expect(client.ensureProfile({ expectedProfileId: 'user_456' })).rejects.toMatchObject({
      status: 502,
      message: 'User API returned a Profile for another User',
    });
  });
});
