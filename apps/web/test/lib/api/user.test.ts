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

  it('patches the Display name with the last-seen Profile version', async () => {
    const tokenProvider = vi.fn().mockResolvedValue('fresh-token');
    const updated = { ...profile, displayName: 'New Name', version: 2 };
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(updated), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetch);
    const client = createUserApiClient({ baseUrl: '/user', tokenProvider });

    await expect(
      client.updateProfile({ displayName: 'New Name', expectedVersion: 1 })
    ).resolves.toEqual(updated);
    expect(fetch).toHaveBeenCalledWith('/user/profile/me', {
      method: 'PATCH',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer fresh-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ displayName: 'New Name', expectedVersion: 1 }),
    });
  });

  it('uploads a picture as authenticated multipart data with the confirmed Profile version', async () => {
    const tokenProvider = vi.fn().mockResolvedValue('fresh-token');
    const picture = new File(['png-bytes'], 'portrait.png', { type: 'image/png' });
    const updated = {
      ...profile,
      version: 2,
      pictureAssetId: 'picture_new',
      pictureImportStatus: 'complete',
      pictureUploadLimits: { maxBytes: 5242880, maxPixels: 20000000, maxDecodedBytes: 80000000 },
    };
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(updated)));
    vi.stubGlobal('fetch', fetch);
    const client = createUserApiClient({ baseUrl: '/user/', tokenProvider });

    await expect(
      client.uploadPicture({ picture, expectedVersion: 1, expectedProfileId: profile.id })
    ).resolves.toEqual(updated);
    expect(tokenProvider).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('/user/profile/me/picture', {
      method: 'PUT',
      headers: { Accept: 'application/json', Authorization: 'Bearer fresh-token' },
      body: expect.any(FormData),
    });
    const body = fetch.mock.calls[0]?.[1].body;
    expect(body.get('picture')).toBe(picture);
    expect(body.get('expectedVersion')).toBe('1');
  });

  it('schedules an alias with a fresh token and adopts its exact expiry from the owner response', async () => {
    const tokenProvider = vi.fn().mockResolvedValue('fresh-token');
    const updated = {
      ...profile,
      version: 2,
      retainedAliasLimit: 3,
      aliases: [
        {
          handle: 'old-handle',
          claimGeneration: 1,
          createdAt: '2026-09-01T12:00:00.000Z',
          expiresAt: '2026-09-15T12:34:56.789Z',
        },
      ],
    };
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(updated)));
    vi.stubGlobal('fetch', fetch);
    const client = createUserApiClient({ baseUrl: '/user/', tokenProvider });

    await expect(
      client.scheduleAliasRemoval({
        handle: 'old-handle',
        expectedVersion: 1,
        expectedProfileId: profile.id,
      })
    ).resolves.toEqual(updated);
    expect(tokenProvider).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('/user/profile/me/aliases/old-handle', {
      method: 'DELETE',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer fresh-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expectedVersion: 1 }),
    });
  });

  it('immediately expires an alias with a fresh token and returns the authoritative owner state', async () => {
    const tokenProvider = vi.fn().mockResolvedValue('fresh-token');
    const updated = { ...profile, version: 3, retainedAliasLimit: 3, aliases: [] };
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(updated)));
    vi.stubGlobal('fetch', fetch);
    const client = createUserApiClient({ baseUrl: '/user/', tokenProvider });

    await expect(
      client.expireAlias({
        handle: 'old-handle',
        expectedVersion: 2,
        expectedProfileId: profile.id,
      })
    ).resolves.toEqual(updated);
    expect(tokenProvider).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('/user/profile/me/aliases/old-handle/expire', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer fresh-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expectedVersion: 2 }),
    });
  });

  it('reactivates a historical Handle with a fresh token and returns the authoritative owner state', async () => {
    const tokenProvider = vi.fn().mockResolvedValue('fresh-token');
    const updated = {
      ...profile,
      version: 4,
      retainedAliasLimit: 3,
      aliases: [
        {
          handle: 'old-handle',
          claimGeneration: 2,
          createdAt: '2026-09-15T12:00:00.000Z',
          expiresAt: null,
        },
      ],
      historicalHandles: [],
    };
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(updated)));
    vi.stubGlobal('fetch', fetch);
    const client = createUserApiClient({ baseUrl: '/user/', tokenProvider });

    await expect(
      client.reactivateAlias({
        handle: 'old-handle',
        expectedVersion: 3,
        expectedProfileId: profile.id,
      })
    ).resolves.toEqual(updated);
    expect(tokenProvider).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('/user/profile/me/aliases/old-handle', {
      method: 'PUT',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer fresh-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expectedVersion: 3 }),
    });
  });

  it('exposes a stale Profile edit as a conflict', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: 'Profile has changed since it was last loaded' }), {
          status: 409,
          headers: { 'Content-Type': 'application/problem+json' },
        })
      )
    );
    const client = createUserApiClient({ baseUrl: '/user', tokenProvider: async () => 'token' });

    await expect(
      client.updateProfile({ displayName: 'New Name', expectedVersion: 1 })
    ).rejects.toMatchObject({ status: 409 });
  });

  it('changes the Handle with a fresh token and last-seen Profile version', async () => {
    const tokenProvider = vi.fn().mockResolvedValue('fresh-token');
    const updated = {
      ...profile,
      handle: 'new-handle',
      version: 2,
      lastHandleChangedAt: '2026-09-14T12:00:00.000Z',
      aliases: [{ handle: profile.handle, claimGeneration: 1 }],
    };
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(updated)));
    vi.stubGlobal('fetch', fetch);
    const client = createUserApiClient({ baseUrl: '/user', tokenProvider });

    await expect(
      client.updateHandle({
        handle: 'New Handle',
        expectedVersion: 1,
        expectedProfileId: profile.id,
      })
    ).resolves.toEqual(updated);
    expect(tokenProvider).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('/user/profile/me/handle', {
      method: 'PUT',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer fresh-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ handle: 'New Handle', expectedVersion: 1 }),
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

  it('preserves the Handle problem type and next permitted change time', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            type: 'https://wallpaperdb.local/problems/handle-cooldown',
            detail: 'You can change your Handle once every seven days.',
            nextHandleChangeAt: '2026-09-21T12:00:00.000Z',
          }),
          { status: 429 }
        )
      )
    );
    const client = createUserApiClient({ baseUrl: '/user', tokenProvider: async () => 'token' });

    await expect(
      client.updateHandle({ handle: 'another-handle', expectedVersion: 2 })
    ).rejects.toMatchObject({
      status: 429,
      type: 'https://wallpaperdb.local/problems/handle-cooldown',
      message: 'You can change your Handle once every seven days.',
      nextHandleChangeAt: '2026-09-21T12:00:00.000Z',
    });
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
