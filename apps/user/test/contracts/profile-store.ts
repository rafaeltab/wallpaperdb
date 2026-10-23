import { Effect } from 'effect';
import { expect, it } from 'vitest';
import type { ProfileDecision, ProfileStore } from '../../src/capabilities/profile/index.js';

export interface ProfileStoreFixture {
  store: ProfileStore;
  // Adapter-specific observation of the declared occurrence effect. This is not
  // an additional application operation on ProfileStore.
  occurrences(): Promise<number>;
}

const now = new Date('2040-01-01T00:00:00.000Z');
const query = { profileId: 'contract-owner', now };
const change: ProfileDecision = {
  _tag: 'Change',
  mutation: { type: 'details', displayName: 'Grace', biographyMarkdown: 'A biography' },
};
const rejected: ProfileDecision = {
  _tag: 'Rejected',
  reason: 'version-conflict',
  message: 'Contract decision rejected',
};
const run = Effect.runPromise;
const seed = (store: ProfileStore, profileId = query.profileId, handle = 'ada') =>
  run(store.create({ profileId, handle, displayName: 'Ada', imageUrl: null, now }));

const cases: ReadonlyArray<{
  id: string;
  check(fixture: ProfileStoreFixture): Promise<void>;
}> = [
  {
    id: 'rejected decision writes neither state nor occurrence',
    async check(f) {
      const before = structuredClone(await seed(f.store));
      const events = await f.occurrences();
      expect(await run(f.store.transact(query, () => rejected)), 'rejection outcome').toEqual({
        outcome: rejected,
        changed: false,
      });
      expect(await run(f.store.read(query.profileId, now)), 'state unchanged').toEqual(before);
      expect(await f.occurrences(), 'no rejected occurrence').toBe(events);
    },
  },
  {
    id: 'unchanged decision writes neither state nor occurrence',
    async check(f) {
      const before = structuredClone(await seed(f.store));
      const events = await f.occurrences();
      expect(
        await run(f.store.transact(query, () => ({ _tag: 'Unchanged' }))),
        'unchanged'
      ).toEqual({ outcome: { _tag: 'Success', profile: before }, changed: false });
      expect(await run(f.store.read(query.profileId, now)), 'state unchanged').toEqual(before);
      expect(await f.occurrences(), 'no unchanged occurrence').toBe(events);
    },
  },
  {
    id: 'each accepted transition advances the version and appends one occurrence',
    async check(f) {
      await seed(f.store);
      const events = await f.occurrences();
      expect(await run(f.store.transact(query, () => change)), 'accepted').toMatchObject({
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
      expect(await run(f.store.read(query.profileId, now)), 'committed state').toMatchObject({
        displayName: 'Grace',
        biographyMarkdown: 'A biography',
        version: 2,
      });
      expect(await f.occurrences(), 'exactly one accepted occurrence').toBe(events + 1);
      expect(
        await run(
          f.store.transact(query, (snapshot) => {
            expect(snapshot.profile.version, 'subsequent locked version').toBe(2);
            return {
              _tag: 'Change',
              mutation: {
                type: 'details',
                displayName: 'Katherine',
                biographyMarkdown: 'Another biography',
              },
            };
          })
        ),
        'subsequent accepted transition'
      ).toMatchObject({
        changed: true,
        outcome: {
          _tag: 'Success',
          profile: {
            displayName: 'Katherine',
            biographyMarkdown: 'Another biography',
            version: 3,
          },
        },
      });
      expect(
        await run(f.store.read(query.profileId, now)),
        'subsequent committed state'
      ).toMatchObject({
        displayName: 'Katherine',
        biographyMarkdown: 'Another biography',
        version: 3,
      });
      expect(await f.occurrences(), 'one occurrence for each accepted transition').toBe(events + 2);
    },
  },
  {
    id: 'conflicting Handle transition leaves both owners and claims unchanged',
    async check(f) {
      const before = structuredClone(await seed(f.store));
      const other = await seed(f.store, 'contract-other', 'occupied');
      const events = await f.occurrences();
      expect(
        await run(
          f.store.transact({ ...query, handle: 'occupied' }, () => ({
            _tag: 'Change',
            mutation: { type: 'handle', handle: 'occupied', scheduledAliases: [] },
          }))
        ),
        'conflict'
      ).toMatchObject({
        changed: false,
        outcome: { _tag: 'Rejected', reason: 'handle-unavailable' },
      });
      expect(await run(f.store.read(query.profileId, now)), 'owner rollback').toEqual(before);
      expect(await run(f.store.read('contract-other', now)), 'other owner intact').toEqual(other);
      await run(
        f.store.transact({ ...query, handle: 'occupied' }, (snapshot) => {
          expect(snapshot.targetClaim?.profileId, 'original claim intact').toBe('contract-other');
          return { _tag: 'Unchanged' };
        })
      );
      expect(await f.occurrences(), 'no rejected occurrence').toBe(events);
    },
  },
  {
    id: 'locked snapshots serialize competing version decisions',
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
        'only one winning decision'
      ).toHaveLength(1);
      expect(
        results.filter((r) => r.outcome._tag === 'Rejected'),
        'stale decision'
      ).toHaveLength(1);
      expect(await run(f.store.read(query.profileId, now)), 'no overwrite').toMatchObject({
        version: 2,
      });
      expect(await f.occurrences(), 'one committed occurrence').toBe(events + 1);
    },
  },
  {
    id: 'observed time is at least the requested lower bound',
    async check(f) {
      await seed(f.store);
      await run(
        f.store.transact(query, (snapshot) => {
          expect(snapshot.observedAt.getTime(), 'observedAt lower bound').toBeGreaterThanOrEqual(
            now.getTime()
          );
          return { _tag: 'Unchanged' };
        })
      );
    },
  },
  {
    id: 'mutating a read result cannot change persisted state',
    async check(f) {
      await seed(f.store);
      await run(
        f.store.transact({ ...query, handle: 'grace' }, () => ({
          _tag: 'Change',
          mutation: { type: 'handle', handle: 'grace', scheduledAliases: [] },
        }))
      );
      const before = structuredClone(await run(f.store.read(query.profileId, now)));
      expect(before).toMatchObject({ handle: 'grace', lastHandleChangedAt: now });
      const read = await run(f.store.read(query.profileId, now));
      if (!read?.lastHandleChangedAt) throw new Error('fixture Handle change failed');
      read.displayName = 'uncommitted';
      for (const date of [read.createdAt, read.updatedAt, read.lastHandleChangedAt])
        date.setUTCFullYear(2099);
      expect(await run(f.store.read(query.profileId, now)), 'detached read').toEqual(before);
    },
  },
  {
    id: 'defective decision commits nothing and remains a defect',
    async check(f) {
      const before = structuredClone(await seed(f.store));
      const events = await f.occurrences();
      const defect = new Error('deliberately defective decision');
      await expect(
        run(
          f.store.transact(query, () => {
            throw defect;
          })
        ),
        'defect identity'
      ).rejects.toBe(defect);
      expect(await run(f.store.read(query.profileId, now)), 'rollback').toEqual(before);
      expect(await f.occurrences(), 'no occurrence').toBe(events);
    },
  },
  {
    id: 'missing profile is an explicit absence',
    async check(f) {
      expect(await run(f.store.read(query.profileId, now)), 'missing record').toBeNull();
      expect(await f.occurrences(), 'reading absence writes nothing').toBe(0);
    },
  },
];

/** Each participant supplies fresh state and observes occurrences through its public adapter interface. */
export function profileStoreContract(
  fixture: () => ProfileStoreFixture | Promise<ProfileStoreFixture>
) {
  for (const { id, check } of cases) {
    it(id, async () => {
      await check(await fixture());
    });
  }
}
