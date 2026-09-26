import { Pictures } from '../src/pictures/index.js';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import { Availability, type Health } from '../src/availability/index.js';
import { createHttpApp } from '../src/http/index.js';
import { Profiles, ProfileUnavailable, type OwnerProfile, type ProfileOutcome } from '../src/profile/index.js';

const profile: OwnerProfile = {
  id: 'user_owner', displayName: 'Owner', handle: 'owner', biographyMarkdown: '',
  pictureAssetId: null, version: 1, lastHandleChangedAt: null,
  createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'),
  biographyMaxLength: 5000, pictureImportStatus: 'complete',
  pictureUploadLimits: { maxBytes: 500, maxPixels: 100, maxDecodedBytes: 400 },
  aliases: [], retainedAliasLimit: 3, historicalHandles: [],
};
const health: Health = { status: 'healthy', checks: { database: true, nats: true, otel: true, workers: true }, timestamp: '2026-01-01T00:00:00.000Z' };
const availability = Layer.succeed(Availability, {
  health: () => Effect.succeed(health),
  ready: () => Effect.succeed({ ready: true, timestamp: health.timestamp }),
});
const token = Buffer.from(JSON.stringify({ id: 'user_owner' })).toString('base64');
const auth = { authorization: `Bearer ${token}` };

function services(ensure: Profiles['ensure'], updateDetails: Profiles['updateDetails'] = () => Effect.die('Unexpected details command')) {
  const unexpected = () => Effect.die('Unexpected profile operation');
  return Layer.mergeAll(availability, Layer.succeed(Pictures, { stage: unexpected, upload: unexpected, pictureAvailable: () => Effect.succeed(false), importPending: unexpected, cleanupExpired: unexpected }), Layer.succeed(Profiles, {
    ensure, updateDetails, changeHandle: unexpected,
    reactivateAlias: unexpected, scheduleAliasExpiry: unexpected,
    expireAliasImmediately: unexpected, expireDueAlias: unexpected,
    adoptPicture: unexpected, adoptImportedPicture: unexpected,
  }));
}

describe('User HTTP adapter', () => {
  it.each([
    ['identity-lookup',503,'identity-unavailable'],
    ['read-profile',500,'generic-server'],
  ] as const)('translates %s technical failure without disclosing diagnostic causes', async (operation,status,type) => {
    const app = await createHttpApp({nodeEnv:'test',port:3009},services(() => Effect.fail(new ProfileUnavailable({operation,cause:new Error('PRIVATE_TOKEN_123')}))));
    try {
      const response=await app.inject({method:'POST',url:'/profile/me/ensure',headers:auth});
      expect(response.statusCode).toBe(status);
      expect(response.json()).toMatchObject({status,type:`https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/${type}.md`});
      expect(response.body).not.toContain('PRIVATE_TOKEN_123');
    } finally {await app.close();}
  });
  it.each(['Bearer not-json','Bearer '+Buffer.from(JSON.stringify({id:''})).toString('base64'),'Basic anything'])('rejects malformed credentials %s', async authorization => {
    const app=await createHttpApp({nodeEnv:'test',port:3009},services(()=>Effect.die('Must not run')));
    try { const response=await app.inject({method:'POST',url:'/profile/me/ensure',headers:{authorization}}); expect(response.statusCode).toBe(401); }
    finally {await app.close();}
  });
  it('protects picture availability with the service token and avoids cached authorization decisions', async () => {
    const app = await createHttpApp({nodeEnv:'test',port:3009,userMediaServiceToken:'test-token'},services(() => Effect.die('Must not run')));
    try {
      const denied = await app.inject({url:'/internal/profile-pictures/pic_missing/availability'});
      expect(denied.statusCode).toBe(401);
      expect(denied.headers['cache-control']).toBe('no-store');
      const missing = await app.inject({url:'/internal/profile-pictures/pic_missing/availability', headers:{authorization:'Bearer test-token'}});
      expect(missing.statusCode).toBe(404);
      expect(missing.headers['cache-control']).toBe('no-store');
    } finally { await app.close(); }
  });
  it.each([
    ['PUT', '/profile/me/handle', { handle: 'new-handle', expectedVersion: 0 }, 'invalid-handle'],
    ['DELETE', '/profile/me/aliases/old', { expectedVersion: 0 }, 'invalid-alias-command'],
    ['POST', '/profile/me/aliases/old/expire', {}, 'invalid-alias-command'],
    ['PUT', '/profile/me/aliases/old', null, 'invalid-alias-command'],
    ['PATCH', '/profile/me', { expectedVersion: 1 }, 'invalid-profile-update'],
  ] as const)('rejects malformed %s %s before calling the capability', async (method, url, payload, type) => {
    const app = await createHttpApp({nodeEnv:'test',port:3009},services(() => Effect.die('Must not run')));
    try {
      const response = await app.inject({method,url,headers:auth,payload:payload ?? undefined});
      expect(response.statusCode).toBe(400);
      expect(response.json().type).toBe(`https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/${type}.md`);
    } finally {await app.close();}
  });
  it('parses detail commands, discards caller ownership, and sends optimistic conflicts as Problem Details', async () => {
    const calls: unknown[] = [];
    const app = await createHttpApp({ nodeEnv: 'test', port: 3009 }, services(() => Effect.die('unexpected'), (principal, changes, version) => {
      calls.push({ principal, changes, version });
      return Effect.succeed({ _tag: 'Rejected', reason: 'version-conflict', message: 'Profile has changed since it was last loaded' });
    }));
    try {
      const result = await app.inject({ method: 'PATCH', url: '/profile/me', headers: auth, payload: { displayName: 'Edited', expectedVersion: 7, profileId: 'victim' } });
      expect(result.statusCode).toBe(409);
      expect(result.headers['content-type']).toContain('application/problem+json');
      expect(result.json()).toMatchObject({ status: 409, type: 'https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/profile-version-conflict.md' });
      expect(calls).toEqual([{ principal: { profileId: 'user_owner' }, changes: { displayName: 'Edited' }, version: 7 }]);
    } finally { await app.close(); }
  });
  it('uses the authenticated principal and preserves the owner response', async () => {
    const calls: string[] = [];
    const app = await createHttpApp({ nodeEnv: 'test', port: 3009 }, services((principal) => {
      calls.push(principal.profileId);
      return Effect.succeed<ProfileOutcome>({ _tag: 'Success', profile });
    }));
    try {
      const result = await app.inject({ method: 'POST', url: '/profile/me/ensure', headers: auth, payload: { profileId: 'user_victim' } });
      expect(result.statusCode).toBe(200);
      expect(result.json()).toEqual(JSON.parse(JSON.stringify(profile)));
      expect(calls).toEqual(['user_owner']);
    } finally { await app.close(); }
  });
});
