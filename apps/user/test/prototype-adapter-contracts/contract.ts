// Opt-in experiment for #419. Expectations come from ProfileStore's declaration,
// not from comparing one implementation's output with another's.
import { Effect } from 'effect';
import { expect } from 'vitest';
import type { ProfileDecision, ProfileStore } from '../../src/capabilities/profile/index.js';

export interface Fixture {
  store: ProfileStore;
  // Adapter-specific observation of the declared occurrence effect. This is not
  // an additional application operation on ProfileStore.
  occurrences(): Promise<number>;
  dispose(): Promise<void>;
}

export const now = new Date('2040-01-01T00:00:00.000Z');
export const query = { profileId: 'contract-owner', now };
export const change: ProfileDecision = {
  _tag: 'Change',
  mutation: { type: 'details', displayName: 'Grace', biographyMarkdown: 'A biography' },
};
export const rejected: ProfileDecision = {
  _tag: 'Rejected',
  reason: 'version-conflict',
  message: 'Contract decision rejected',
};
export const run = Effect.runPromise;
export const seed = (store: ProfileStore, profileId = query.profileId, handle = 'ada') =>
  run(store.create({ profileId, handle, displayName: 'Ada', imageUrl: null, now }));

export const cases: ReadonlyArray<{
  id: string;
  check(fixture: Fixture): Promise<void>;
}> = [
  {
    id: 'G1 rejected decision writes neither state nor occurrence',
    async check(f) {
      const before = await seed(f.store);
      const events = await f.occurrences();
      expect(await run(f.store.transact(query, () => rejected)), 'G1 rejection outcome').toEqual({
        outcome: rejected,
        changed: false,
      });
      expect(await run(f.store.read(query.profileId, now)), 'G1 state unchanged').toEqual(before);
      expect(await f.occurrences(), 'G1 no rejected occurrence').toBe(events);
    },
  },
  {
    id: 'G2 unchanged decision writes neither state nor occurrence',
    async check(f) {
      const before = await seed(f.store);
      const events = await f.occurrences();
      expect(
        await run(f.store.transact(query, () => ({ _tag: 'Unchanged' }))),
        'G2 unchanged'
      ).toEqual({ outcome: { _tag: 'Success', profile: before }, changed: false });
      expect(await run(f.store.read(query.profileId, now)), 'G2 state unchanged').toEqual(before);
      expect(await f.occurrences(), 'G2 no unchanged occurrence').toBe(events);
    },
  },
  {
    id: 'G3 accepted transition exposes committed state and one occurrence',
    async check(f) {
      await seed(f.store);
      const events = await f.occurrences();
      expect(await run(f.store.transact(query, () => change)), 'G3 accepted').toMatchObject({
        changed: true,
        outcome: {
          _tag: 'Success',
          profile: {
            displayName: 'Grace',
            biographyMarkdown: 'A biography',
            version: 2,
          },
        },
      });
      expect(await run(f.store.read(query.profileId, now)), 'G3 committed state').toMatchObject({
        displayName: 'Grace',
        biographyMarkdown: 'A biography',
        version: 2,
      });
      expect(await f.occurrences(), 'G3 exactly one accepted occurrence').toBe(events + 1);
    },
  },
  {
    id: 'G4 conflicting Handle transition leaves both owners and claims unchanged',
    async check(f) {
      const before = await seed(f.store);
      const other = await seed(f.store, 'contract-other', 'occupied');
      const events = await f.occurrences();
      expect(
        await run(
          f.store.transact({ ...query, handle: 'occupied' }, () => ({
            _tag: 'Change',
            mutation: { type: 'handle', handle: 'occupied', scheduledAliases: [] },
          }))
        ),
        'G4 conflict'
      ).toMatchObject({
        changed: false,
        outcome: { _tag: 'Rejected', reason: 'handle-unavailable' },
      });
      expect(await run(f.store.read(query.profileId, now)), 'G4 owner rollback').toEqual(before);
      expect(await run(f.store.read('contract-other', now)), 'G4 other owner intact').toEqual(
        other
      );
      await run(
        f.store.transact({ ...query, handle: 'occupied' }, (snapshot) => {
          expect(snapshot.targetClaim?.profileId, 'G4 original claim intact').toBe(
            'contract-other'
          );
          return { _tag: 'Unchanged' };
        })
      );
      expect(await f.occurrences(), 'G4 no rejected occurrence').toBe(events);
    },
  },
  {
    id: 'G5 locked snapshots serialize competing version decisions',
    async check(f) {
      await seed(f.store);
      const events = await f.occurrences();
      // Version comparison is a caller decision. The adapter must supply a
      // locked current snapshot, not implement expectedVersion policy itself.
      const results = await Promise.all(
        [0, 1].map(() =>
          run(
            f.store.transact(query, (snapshot) =>
              snapshot.profile.version === 1 ? change : rejected
            )
          )
        )
      );
      expect(
        results.filter((r) => r.changed),
        'G5 only one winning decision'
      ).toHaveLength(1);
      expect(
        results.filter((r) => r.outcome._tag === 'Rejected'),
        'G5 stale decision'
      ).toHaveLength(1);
      expect(await run(f.store.read(query.profileId, now)), 'G5 no overwrite').toMatchObject({
        version: 2,
      });
      expect(await f.occurrences(), 'G5 one committed occurrence').toBe(events + 1);
    },
  },
  {
    id: 'G6 observed time is at least the requested lower bound',
    async check(f) {
      await seed(f.store);
      await run(
        f.store.transact(query, (snapshot) => {
          expect(snapshot.observedAt.getTime(), 'G6 observedAt lower bound').toBeGreaterThanOrEqual(
            now.getTime()
          );
          return { _tag: 'Unchanged' };
        })
      );
    },
  },
  {
    id: 'G7 mutating a read result cannot change persisted state',
    async check(f) {
      const before = await seed(f.store);
      const read = await run(f.store.read(query.profileId, now));
      if (!read) throw new Error('G7 fixture creation failed');
      read.displayName = 'uncommitted';
      read.updatedAt.setUTCFullYear(2099);
      expect(await run(f.store.read(query.profileId, now)), 'G7 detached read').toEqual(before);
    },
  },
  {
    id: 'G8 defective decision commits nothing and remains a defect',
    async check(f) {
      const before = await seed(f.store);
      const events = await f.occurrences();
      const defect = new Error('G8 deliberately defective decision');
      await expect(
        run(
          f.store.transact(query, () => {
            throw defect;
          })
        ),
        'G8 defect identity'
      ).rejects.toBe(defect);
      expect(await run(f.store.read(query.profileId, now)), 'G8 rollback').toEqual(before);
      expect(await f.occurrences(), 'G8 no occurrence').toBe(events);
    },
  },
];
