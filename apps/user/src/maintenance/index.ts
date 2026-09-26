import { Clock, Context, Data, Effect, Layer } from 'effect';
import { type AliasClaimReference, Profiles } from '../profile/index.js';

export class MaintenanceFailure extends Data.TaggedError('MaintenanceFailure')<{
  readonly operation: string;
  readonly cause: unknown;
}> {}
export interface EventReference {
  readonly id: string;
  readonly createdAt: Date;
}
export interface DueAlias extends AliasClaimReference {
  readonly expiresAt: Date;
}
export interface BatchResult {
  readonly completed: number;
  readonly failed: number;
}
export interface WallpaperOwnership {
  readonly wallpaperId: string;
  readonly profileId: string;
}
/** Reads only unpublished Profile events in stable creation/identity order, in pages of 100. */
export interface MaintenanceStore {
  /** Due aliases in expiry/Handle order, at most 100. Expiry must recheck the claim before changing it. */
  dueAliases(now: Date, after?: DueAlias): Effect.Effect<readonly DueAlias[], MaintenanceFailure>;
  pendingEvents(
    after?: EventReference
  ): Effect.Effect<readonly EventReference[], MaintenanceFailure>;
  /** Marks only the identified, still unpublished event after its publication was acknowledged. */
  markPublished(id: string, now: Date): Effect.Effect<void, MaintenanceFailure>;
  /** Only acknowledged Profile evidence at/before cutoff is eligible; pages contain at most 100. */
  expiredEvents(
    cutoff: Date,
    after?: EventReference
  ): Effect.Effect<readonly EventReference[], MaintenanceFailure>;
  /** Rechecks publication, subject and cutoff before deletion; unrelated records never change. */
  deleteExpiredEvent(id: string, cutoff: Date): Effect.Effect<boolean, MaintenanceFailure>;
  /** The first accepted owner remains immutable under concurrent duplicates and later conflicting facts. */
  recordWallpaperOwnership(ownership: WallpaperOwnership): Effect.Effect<void, MaintenanceFailure>;
}
export const MaintenanceStore = Context.Service<MaintenanceStore>(
  'wallpaperdb.user.MaintenanceStore'
);
/** Publishes the recorded event using its original identity; success requires durable broker acceptance. */
export interface ProfileEvents {
  publish(eventId: string): Effect.Effect<void, MaintenanceFailure>;
}
export const ProfileEvents = Context.Service<ProfileEvents>('wallpaperdb.user.ProfileEvents');
export interface Maintenance {
  expireAliases(
    now: Date,
    isStopping?: () => boolean
  ): Effect.Effect<BatchResult, MaintenanceFailure>;
  publishPending(isStopping?: () => boolean): Effect.Effect<BatchResult, MaintenanceFailure>;
  cleanupEvents(
    now: Date,
    isStopping?: () => boolean
  ): Effect.Effect<{ deleted: number; failed: number }, MaintenanceFailure>;
  recordWallpaperOwnership(ownership: WallpaperOwnership): Effect.Effect<void, MaintenanceFailure>;
}
export const Maintenance = Context.Service<Maintenance>('wallpaperdb.user.Maintenance');

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
        (_input: void, after?: EventReference) => store.pendingEvents(after),
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
