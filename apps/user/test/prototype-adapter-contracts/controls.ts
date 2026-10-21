// Deliberately incompatible adapters belong only to this opt-in experiment.
// They never replace the helper used by ordinary capability tests.
import { Effect } from 'effect';
import type { ProfileStore } from '../../src/capabilities/profile/index.js';
import { controlledProfiles } from '../helpers/profiles.js';
import { change, type Fixture } from './contract.js';

export type Control =
  | 'valid'
  | 'later-clock'
  | 'rejection-writes'
  | 'unchanged-writes'
  | 'drops-occurrences'
  | 'stale-snapshot'
  | 'missing-asset';

export function controlFixture(control: Control): Fixture & {
  stagePicture: ReturnType<typeof controlledProfiles>['stagePicture'];
} {
  const controlled = controlledProfiles();
  const base = controlled.store;
  const store: ProfileStore = {
    ...base,
    transact: (query, decide) =>
      Effect.suspend(() => {
        const before = controlled.transitions.length;
        const observedQuery =
          control === 'later-clock'
            ? { ...query, now: new Date(query.now.getTime() + 60000) }
            : query;
        return base
          .transact(observedQuery, (snapshot) => {
            const decision = decide(
              control === 'stale-snapshot'
                ? { ...snapshot, profile: { ...snapshot.profile, version: 1 } }
                : control === 'missing-asset'
                  ? { ...snapshot, asset: null }
                  : snapshot
            );
            if (
              (control === 'rejection-writes' && decision._tag === 'Rejected') ||
              (control === 'unchanged-writes' && decision._tag === 'Unchanged')
            )
              return change;
            return decision;
          })
          .pipe(
            Effect.tap((result) =>
              Effect.sync(() => {
                if (control === 'drops-occurrences' && result.changed)
                  controlled.transitions.splice(before);
              })
            )
          );
      }),
  };
  return {
    store,
    stagePicture: controlled.stagePicture,
    occurrences: async () => controlled.transitions.length,
    dispose: async () => {},
  };
}
