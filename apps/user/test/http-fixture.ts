import { Effect, Layer } from 'effect';
import { Pictures } from '../src/pictures/index.js';
import { Availability, type Health } from '../src/availability/index.js';
import { Profiles, type OwnerProfile } from '../src/profile/index.js';
export const profile: OwnerProfile = {
  id: 'user_owner',
  displayName: 'Owner',
  handle: 'owner',
  biographyMarkdown: '',
  pictureAssetId: null,
  version: 1,
  lastHandleChangedAt: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  biographyMaxLength: 5000,
  pictureImportStatus: 'complete',
  pictureUploadLimits: { maxBytes: 500, maxPixels: 100, maxDecodedBytes: 400 },
  aliases: [],
  retainedAliasLimit: 3,
  historicalHandles: [],
};
const health: Health = {
  status: 'healthy',
  checks: { database: true, nats: true, otel: true, workers: true },
  timestamp: '2026-01-01T00:00:00.000Z',
};
const availability = Layer.succeed(Availability, {
  health: () => Effect.succeed(health),
  ready: () => Effect.succeed({ ready: true, timestamp: health.timestamp }),
});
const token = Buffer.from(JSON.stringify({ id: 'user_owner' })).toString('base64');
export const auth = { authorization: `Bearer ${token}` };

export function services(
  ensure: Profiles['ensure'],
  updateDetails: Profiles['updateDetails'] = () => Effect.die('Unexpected details command'),
  overrides: Partial<Profiles> = {}
) {
  const unexpected = () => Effect.die('Unexpected profile operation');
  return Layer.mergeAll(
    availability,
    Layer.succeed(Pictures, {
      stage: unexpected,
      upload: unexpected,
      pictureAvailable: () => Effect.succeed(false),
      importPending: unexpected,
      cleanupExpired: unexpected,
    }),
    Layer.succeed(Profiles, {
      ensure,
      updateDetails,
      changeHandle: unexpected,
      reactivateAlias: unexpected,
      scheduleAliasExpiry: unexpected,
      expireAliasImmediately: unexpected,
      expireDueAlias: unexpected,
      adoptPicture: unexpected,
      adoptImportedPicture: unexpected,
      ...overrides,
    })
  );
}
