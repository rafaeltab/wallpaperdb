import { Clock, Effect, Layer } from 'effect';
import { Profiles } from '../profile/index.js';
import type { DueAlias, EventReference, WallpaperOwnership } from './contract.js';
import {
  Maintenance,
  type MaintenanceFailure,
  MaintenanceStore,
  ProfileEvents,
} from './contract.js';

/** Each workflow owns a cursor, but shares the rule that failed rows must not
 * block later pages and shutdown must preserve the last attempted position. */
function batchProcessor<Item, Input, Failure>(
  read: (input: Input, after?: Item) => Effect.Effect<readonly Item[], MaintenanceFailure>,
  process: (item: Item, input: Input) => Effect.Effect<boolean, Failure>
) {
  let cursor: Item | undefined;
  return (input: Input, isStopping: () => boolean) =>
    Effect.gen(function* () {
      const result = { completed: 0, failed: 0 };
      if (isStopping()) return result;
      const batch = yield* read(input, cursor);
      for (const item of batch) {
        if (isStopping()) break;
        cursor = item;
        yield* process(item, input).pipe(
          Effect.match({
            onSuccess: (completed) => {
              if (completed) result.completed++;
            },
            onFailure: () => {
              result.failed++;
            },
          })
        );
      }
      if (batch.length < 100 && !isStopping()) cursor = undefined;
      return result;
    });
}

export const maintenanceLayer = (policy: { retentionDays: number }) =>
  Layer.effect(
    Maintenance,
    Effect.gen(function* () {
      const store = yield* MaintenanceStore;
      const events = yield* ProfileEvents;
      const profiles = yield* Profiles;
      const expireAliases = batchProcessor(
        (now: Date, after?: DueAlias) => store.dueAliases(now, after),
        (alias, now) => profiles.expireDueAlias(alias, now)
      );
      const cleanupEvents = batchProcessor(
        (cutoff: Date, after?: EventReference) => store.expiredEvents(cutoff, after),
        (event, cutoff) => store.deleteExpiredEvent(event.id, cutoff)
      );
      const publishPending = batchProcessor(
        (_input: undefined, after?: EventReference) => store.pendingEvents(after),
        (event) =>
          events.publish(event.id).pipe(
            Effect.andThen(() =>
              Clock.currentTimeMillis.pipe(
                Effect.flatMap((now) => store.markPublished(event.id, new Date(now)))
              )
            ),
            Effect.as(true)
          )
      );
      return Maintenance.of({
        expireAliases: Effect.fn('profiles.expire-aliases')((now, isStopping = () => false) =>
          expireAliases(now, isStopping)
        ),
        recordWallpaperOwnership: Effect.fn('profiles.record-wallpaper-ownership')(
          (ownership: WallpaperOwnership) => store.recordWallpaperOwnership(ownership)
        ),
        cleanupEvents: Effect.fn('profiles.cleanup-events')((now, isStopping = () => false) =>
          cleanupEvents(
            new Date(now.getTime() - policy.retentionDays * 86_400_000),
            isStopping
          ).pipe(Effect.map(({ completed, failed }) => ({ deleted: completed, failed })))
        ),
        publishPending: Effect.fn('profiles.publish-pending')((isStopping = () => false) =>
          publishPending(undefined, isStopping)
        ),
      });
    })
  );
