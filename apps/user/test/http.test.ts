import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { createHttpApp } from '../src/http/index.js';
import { ProfileUnavailable, type ProfileOutcome, type Profiles } from '../src/profile/index.js';
import { profile, auth, services } from './http-fixture.js';

describe('User HTTP adapter', () => {
  it.each([
    ['unauthorized', 401, 'unauthorized'],
    ['invalid-display-name', 400, 'invalid-display-name'],
    ['invalid-biography', 400, 'invalid-biography'],
    ['unavailable-biography-wallpaper', 400, 'unavailable-wallpaper'],
    ['invalid-handle', 400, 'invalid-handle'],
    ['invalid-alias-command', 400, 'invalid-alias-command'],
    ['ineligible-handle', 400, 'ineligible-handle'],
    ['alias-limit', 409, 'alias-limit'],
    ['alias-not-found', 404, 'alias-not-found'],
    ['alias-not-scheduled', 409, 'alias-not-scheduled'],
    ['handle-unavailable', 409, 'handle-unavailable'],
    ['handle-cooldown', 429, 'handle-cooldown'],
    ['version-conflict', 409, 'profile-version-conflict'],
    ['picture-unavailable', 400, 'picture-unavailable'],
  ] as const)('translates the %s decision into its public Problem Details contract', async (reason, status, type) => {
    const app = await createHttpApp(
      { nodeEnv: 'test', port: 0 },
      services(() =>
        Effect.succeed({
          _tag: 'Rejected',
          reason,
          message: 'Public rejection detail',
          ...(reason === 'unavailable-biography-wallpaper' ? { retryable: false } : {}),
          ...(reason === 'handle-cooldown'
            ? { nextHandleChangeAt: new Date('2030-01-08T00:00:00.000Z') }
            : {}),
        })
      )
    );
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/profile/me/ensure',
        headers: auth,
      });
      expect(response.statusCode).toBe(status);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.json()).toMatchObject({
        status,
        type: `https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/${type}.md`,
        detail: 'Public rejection detail',
        instance: '/profile/me/ensure',
      });
      if (reason === 'unavailable-biography-wallpaper')
        expect(response.json().retryable).toBe(false);
      if (reason === 'handle-cooldown')
        expect(response.json().nextHandleChangeAt).toBe('2030-01-08T00:00:00.000Z');
    } finally {
      await app.close();
    }
  });
  it.each([
    ['PUT', '/profile/me/handle', 'changeHandle', 'invalid-handle'],
    ['DELETE', '/profile/me/aliases/old-handle', 'scheduleAliasExpiry', 'invalid-alias-command'],
    [
      'POST',
      '/profile/me/aliases/old-handle/expire',
      'expireAliasImmediately',
      'invalid-alias-command',
    ],
    ['PUT', '/profile/me/aliases/old-handle', 'reactivateAlias', 'invalid-alias-command'],
  ] as const)('authenticates and parses the %s %s command at the HTTP boundary', async (method, url, action, type) => {
    const calls: unknown[] = [];
    const record =
      (name: string): Profiles['changeHandle'] =>
      (principal, handle, expectedVersion) => {
        calls.push({ action: name, principal, handle, expectedVersion });
        return Effect.succeed({ _tag: 'Success', profile });
      };
    const app = await createHttpApp(
      { nodeEnv: 'test', port: 0 },
      services(() => Effect.die('Unexpected ensure'), undefined, {
        changeHandle: record('changeHandle'),
        scheduleAliasExpiry: record('scheduleAliasExpiry'),
        expireAliasImmediately: record('expireAliasImmediately'),
        reactivateAlias: record('reactivateAlias'),
      })
    );
    try {
      const unauthenticated = await app.inject({
        method,
        url,
        payload: { handle: 'new-handle', expectedVersion: 7 },
      });
      expect(unauthenticated.statusCode).toBe(401);
      expect(unauthenticated.json().type).toBe(
        'https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/unauthorized.md'
      );
      for (const expectedVersion of [
        undefined,
        null,
        0,
        -1,
        1.5,
        '1',
        Number.MAX_SAFE_INTEGER + 1,
      ]) {
        const invalid = await app.inject({
          method,
          url,
          headers: auth,
          payload: { handle: 'new-handle', expectedVersion },
        });
        expect(invalid.statusCode).toBe(400);
        expect(invalid.headers['content-type']).toContain('application/problem+json');
        expect(invalid.json()).toMatchObject({
          status: 400,
          type: `https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/${type}.md`,
        });
      }
      if (action === 'changeHandle') {
        for (const handle of [undefined, null, 1, {}]) {
          const invalid = await app.inject({
            method,
            url,
            headers: auth,
            payload: { handle, expectedVersion: 7 },
          });
          expect(invalid.statusCode).toBe(400);
          expect(invalid.json().type).toBe(
            'https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/invalid-handle.md'
          );
        }
      }
      expect(calls).toEqual([]);
      const accepted = await app.inject({
        method,
        url,
        headers: auth,
        payload: { handle: 'new-handle', expectedVersion: 7, profileId: 'victim' },
      });
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json()).toMatchObject({ id: 'user_owner', version: 1 });
      expect(calls).toEqual([
        {
          action,
          principal: { profileId: 'user_owner' },
          handle: action === 'changeHandle' ? 'new-handle' : 'old-handle',
          expectedVersion: 7,
        },
      ]);
    } finally {
      await app.close();
    }
  });
  it.each([
    ['identity-lookup', 503, 'identity-unavailable'],
    ['read-profile', 500, 'generic-server'],
  ] as const)('translates %s technical failure without disclosing diagnostic causes', async (operation, status, type) => {
    const app = await createHttpApp(
      { nodeEnv: 'test', port: 3009 },
      services(() =>
        Effect.fail(new ProfileUnavailable({ operation, cause: new Error('PRIVATE_TOKEN_123') }))
      )
    );
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/profile/me/ensure',
        headers: auth,
      });
      expect(response.statusCode).toBe(status);
      expect(response.json()).toMatchObject({
        status,
        type: `https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/${type}.md`,
      });
      expect(response.body).not.toContain('PRIVATE_TOKEN_123');
    } finally {
      await app.close();
    }
  });
  it.each([
    'Bearer not-json',
    `Bearer ${Buffer.from(JSON.stringify({ id: '' })).toString('base64')}`,
    'Basic anything',
  ])('rejects malformed credentials %s', async (authorization) => {
    const app = await createHttpApp(
      { nodeEnv: 'test', port: 3009 },
      services(() => Effect.die('Must not run'))
    );
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/profile/me/ensure',
        headers: { authorization },
      });
      expect(response.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
  it('protects picture availability with the service token and avoids cached authorization decisions', async () => {
    const app = await createHttpApp(
      { nodeEnv: 'test', port: 3009, userMediaServiceToken: 'test-token' },
      services(() => Effect.die('Must not run'))
    );
    try {
      const denied = await app.inject({
        url: '/internal/profile-pictures/pic_missing/availability',
      });
      expect(denied.statusCode).toBe(401);
      expect(denied.headers['cache-control']).toBe('no-store');
      const missing = await app.inject({
        url: '/internal/profile-pictures/pic_missing/availability',
        headers: { authorization: 'Bearer test-token' },
      });
      expect(missing.statusCode).toBe(404);
      expect(missing.headers['cache-control']).toBe('no-store');
    } finally {
      await app.close();
    }
  });
  it.each([
    ['PUT', '/profile/me/handle', { handle: 'new-handle', expectedVersion: 0 }, 'invalid-handle'],
    ['DELETE', '/profile/me/aliases/old', { expectedVersion: 0 }, 'invalid-alias-command'],
    ['POST', '/profile/me/aliases/old/expire', {}, 'invalid-alias-command'],
    ['PUT', '/profile/me/aliases/old', null, 'invalid-alias-command'],
    ['PATCH', '/profile/me', { expectedVersion: 1 }, 'invalid-profile-update'],
  ] as const)('rejects malformed %s %s before calling the capability', async (method, url, payload, type) => {
    const app = await createHttpApp(
      { nodeEnv: 'test', port: 3009 },
      services(() => Effect.die('Must not run'))
    );
    try {
      const response = await app.inject({
        method,
        url,
        headers: auth,
        payload: payload ?? undefined,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().type).toBe(
        `https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/${type}.md`
      );
    } finally {
      await app.close();
    }
  });
  it('parses detail commands, discards caller ownership, and sends optimistic conflicts as Problem Details', async () => {
    const calls: unknown[] = [];
    const app = await createHttpApp(
      { nodeEnv: 'test', port: 3009 },
      services(
        () => Effect.die('unexpected'),
        (principal, changes, version) => {
          calls.push({ principal, changes, version });
          return Effect.succeed({
            _tag: 'Rejected',
            reason: 'version-conflict',
            message: 'Profile has changed since it was last loaded',
          });
        }
      )
    );
    try {
      const result = await app.inject({
        method: 'PATCH',
        url: '/profile/me',
        headers: auth,
        payload: { displayName: 'Edited', expectedVersion: 7, profileId: 'victim' },
      });
      expect(result.statusCode).toBe(409);
      expect(result.headers['content-type']).toContain('application/problem+json');
      expect(result.json()).toMatchObject({
        status: 409,
        type: 'https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/profile-version-conflict.md',
      });
      expect(calls).toEqual([
        { principal: { profileId: 'user_owner' }, changes: { displayName: 'Edited' }, version: 7 },
      ]);
    } finally {
      await app.close();
    }
  });
  it('uses the authenticated principal and preserves the owner response', async () => {
    const calls: string[] = [];
    const app = await createHttpApp(
      { nodeEnv: 'test', port: 3009 },
      services((principal) => {
        calls.push(principal.profileId);
        return Effect.succeed<ProfileOutcome>({ _tag: 'Success', profile });
      })
    );
    try {
      const result = await app.inject({
        method: 'POST',
        url: '/profile/me/ensure',
        headers: auth,
        payload: { profileId: 'user_victim' },
      });
      expect(result.statusCode).toBe(200);
      expect(result.json()).toEqual(JSON.parse(JSON.stringify(profile)));
      expect(calls).toEqual(['user_owner']);
    } finally {
      await app.close();
    }
  });
});
