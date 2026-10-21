import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  Identities,
  Profiles,
  ProfileStore,
  profilesLayer,
} from '../../src/capabilities/profile/index.js';
import { cases, now, query, run, seed } from './contract.js';
import { controlFixture, type Control } from './controls.js';
import { profilePolicy } from '../helpers/profiles.js';

const controls: ReadonlyArray<{ name: Control; failures: readonly string[] }> = [
  { name: 'valid', failures: [] },
  { name: 'later-clock', failures: [] },
  { name: 'rejection-writes', failures: ['G1', 'G5'] },
  { name: 'unchanged-writes', failures: ['G2', 'G4'] },
  { name: 'drops-occurrences', failures: ['G3', 'G5'] },
  { name: 'stale-snapshot', failures: ['G5'] },
  // Intentional missed case: this bounded pilot does not exercise picture assets.
  { name: 'missing-asset', failures: [] },
];

// A raw run exits nonzero on the deliberate fault and prints its diagnostic.
const rawControl = process.env.PROTOTYPE_419_RAW_CONTROL;
if (rawControl && !controls.some((control) => control.name === rawControl)) {
  throw new Error(`Unknown PROTOTYPE_419_RAW_CONTROL: ${rawControl}`);
}

for (const control of controls.filter((control) => !rawControl || control.name === rawControl))
  describe(control.name, () => {
    it('still passes a real Profiles capability happy path', async () => {
      const f = controlFixture(control.name);
      try {
        const layer = profilesLayer(profilePolicy).pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(ProfileStore, f.store),
              Layer.succeed(Identities, {
                getIdentity: () =>
                  Effect.succeed({ displayName: 'Ada', firstName: null, lastName: null }),
              })
            )
          )
        );
        const result = await run(
          Effect.gen(function* () {
            const profiles = yield* Profiles;
            yield* profiles.ensure({ profileId: query.profileId });
            return yield* profiles.updateDetails(
              { profileId: query.profileId },
              { displayName: 'Grace' },
              1
            );
          }).pipe(Effect.provide(layer))
        );
        expect(result).toMatchObject({
          _tag: 'Success',
          profile: { displayName: 'Grace', version: 2 },
        });
      } finally {
        await f.dispose();
      }
    });

    for (const test of cases)
      it(test.id, async () => {
        const f = controlFixture(control.name);
        try {
          const check = test.check(f);
          if (!rawControl && control.failures.includes(test.id.slice(0, 2))) {
            // Match the guarantee ID. An arbitrary setup failure is not a detection.
            await expect(check).rejects.toThrow(new RegExp(test.id.slice(0, 2)));
          } else await check;
        } finally {
          await f.dispose();
        }
      });
  });

it('confirms the missing-asset control is a real fault outside the shared cases', async () => {
  for (const name of ['valid', 'missing-asset'] as const) {
    const f = controlFixture(name);
    try {
      await seed(f.store);
      f.stagePicture({
        id: 'staged',
        profileId: query.profileId,
        expiresAt: new Date('2041-01-01'),
      });
      const witness = run(
        f.store.transact({ ...query, assetId: 'staged', now }, (snapshot) => {
          expect(snapshot.asset?.id, 'asset lookup witness').toBe('staged');
          return { _tag: 'Unchanged' };
        })
      );
      if (name === 'valid') await witness;
      else await expect(witness).rejects.toThrow(/asset lookup witness/);
    } finally {
      await f.dispose();
    }
  }
});
