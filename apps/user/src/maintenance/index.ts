import { Clock, Context, Data, Effect, Layer } from 'effect';

export class MaintenanceFailure extends Data.TaggedError('MaintenanceFailure')<{
  readonly operation: string;
  readonly cause: unknown;
}> {}
export interface EventReference {
  readonly id: string;
  readonly createdAt: Date;
}
export interface BatchResult {
  readonly completed: number;
  readonly failed: number;
}
/** Reads only unpublished Profile events in stable creation/identity order, in pages of 100. */
export interface MaintenanceStore {
  pendingEvents(
    after?: EventReference
  ): Effect.Effect<readonly EventReference[], MaintenanceFailure>;
  /** Marks only the identified, still unpublished event after its publication was acknowledged. */
  markPublished(id: string, now: Date): Effect.Effect<void, MaintenanceFailure>;
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
  publishPending(isStopping?: () => boolean): Effect.Effect<BatchResult, MaintenanceFailure>;
}
export const Maintenance = Context.Service<Maintenance>('wallpaperdb.user.Maintenance');

export const maintenanceLayer = Layer.effect(
  Maintenance,
  Effect.gen(function* () {
    const store = yield* MaintenanceStore;
    const events = yield* ProfileEvents;
    let cursor: EventReference | undefined;
    return Maintenance.of({
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
