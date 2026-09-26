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

export const maintenanceLayer = (policy: { retentionDays: number }) =>
  Layer.effect(
    Maintenance,
    Effect.gen(function* () {
      const store = yield* MaintenanceStore;
      const events = yield* ProfileEvents;
      const profiles = yield* Profiles;
      let cursor: EventReference | undefined;
      let cleanupCursor: EventReference | undefined;
      let aliasCursor: DueAlias | undefined;
      return Maintenance.of({
        expireAliases: Effect.fn('profiles.expire-aliases')(function* (
          now: Date,
          isStopping = () => false
        ) {
          if (isStopping()) return { completed: 0, failed: 0 };
          const batch = yield* store.dueAliases(now, aliasCursor);
          let completed = 0;
          let failed = 0;
          for (const alias of batch) {
            if (isStopping()) break;
            aliasCursor = alias;
            const result = yield* profiles.expireDueAlias(alias, now).pipe(
              Effect.match({
                onSuccess: (expired) => (expired ? 'expired' : 'unchanged'),
                onFailure: () => 'failed',
              })
            );
            if (result === 'expired') completed++;
            if (result === 'failed') failed++;
          }
          if (batch.length < 100 && !isStopping()) aliasCursor = undefined;
          return { completed, failed };
        }),
        recordWallpaperOwnership: Effect.fn('profiles.record-wallpaper-ownership')(
          (ownership: WallpaperOwnership) => store.recordWallpaperOwnership(ownership)
        ),
        cleanupEvents: Effect.fn('profiles.cleanup-events')(function* (
          now: Date,
          isStopping = () => false
        ) {
          if (isStopping()) return { deleted: 0, failed: 0 };
          const cutoff = new Date(now.getTime() - policy.retentionDays * 86_400_000);
          const batch = yield* store.expiredEvents(cutoff, cleanupCursor);
          let deleted = 0;
          let failed = 0;
          for (const event of batch) {
            if (isStopping()) break;
            cleanupCursor = event;
            const result = yield* store.deleteExpiredEvent(event.id, cutoff).pipe(
              Effect.match({
                onSuccess: (removed) => (removed ? 'deleted' : 'unchanged'),
                onFailure: () => 'failed',
              })
            );
            if (result === 'deleted') deleted++;
            if (result === 'failed') failed++;
          }
          if (batch.length < 100 && !isStopping()) cleanupCursor = undefined;
          return { deleted, failed };
        }),
        publishPending: Effect.fn('profiles.publish-pending')(function* (isStopping = () => false) {
          if (isStopping()) return { completed: 0, failed: 0 };
          const batch = yield* store.pendingEvents(cursor);
          let completed = 0;
          let failed = 0;
          for (const event of batch) {
            if (isStopping()) break;
            cursor = event;
            const accepted = yield* events.publish(event.id).pipe(
              Effect.andThen(() =>
                Clock.currentTimeMillis.pipe(
                  Effect.flatMap((now) => store.markPublished(event.id, new Date(now)))
                )
              ),
              Effect.match({ onSuccess: () => true, onFailure: () => false })
            );
            if (accepted) completed++;
            else failed++;
          }
          if (batch.length < 100 && !isStopping()) cursor = undefined;
          return { completed, failed };
        }),
      });
    })
  );
