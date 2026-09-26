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

function services(ensure: Profiles['ensure']) {
  const unexpected = () => Effect.die('Unexpected profile operation');
  return Layer.merge(availability, Layer.succeed(Profiles, {
    ensure, updateDetails: unexpected, changeHandle: unexpected,
    reactivateAlias: unexpected, scheduleAliasExpiry: unexpected,
    expireAliasImmediately: unexpected, expireDueAlias: unexpected,
    adoptPicture: unexpected, adoptImportedPicture: unexpected,
  }));
}

describe('User HTTP adapter', () => {
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
