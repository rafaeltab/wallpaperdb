import { and, eq, gt, inArray, isNull, isNotNull, lte, or } from 'drizzle-orm';
import { Effect, Layer } from 'effect';
import { outboxEvents, wallpaperOwnership } from '../../db/schema.js';
import { MaintenanceFailure, MaintenanceStore } from '../../maintenance/index.js';
import { Database } from '../database/index.js';

const expired = (cutoff: Date) =>
  and(
    inArray(outboxEvents.subject, ['profile.created', 'profile.updated']),
    isNotNull(outboxEvents.publishedAt),
    lte(outboxEvents.createdAt, cutoff)
  );

export const eventStoreLayer = () =>
  Layer.effect(
    MaintenanceStore,
    Effect.gen(function* () {
      const database = yield* Database;
      const execute = <A>(
        operation: string,
        run: (db: Parameters<Parameters<Database['run']>[0]>[0]) => Promise<A>
      ) =>
        Effect.tryPromise({
          try: (signal) => database.run(run, signal),
          catch: (cause) => new MaintenanceFailure({ operation, cause }),
        }).pipe(
          Effect.tapError((failure) =>
            Effect.logError('Profile maintenance persistence unavailable', {
              operation,
              cause: failure.cause,
            })
          )
        );
      return MaintenanceStore.of({
        recordWallpaperOwnership: (ownership) =>
          execute('record-wallpaper-ownership', async (db) => {
            await db
              .insert(wallpaperOwnership)
              .values(ownership)
              .onConflictDoNothing({ target: wallpaperOwnership.wallpaperId });
          }),
        expiredEvents: (cutoff, after) =>
          execute('expired-events', (db) =>
            db
              .select({ id: outboxEvents.id, createdAt: outboxEvents.createdAt })
              .from(outboxEvents)
              .where(
                and(
                  expired(cutoff),
                  after
                    ? or(
                        gt(outboxEvents.createdAt, after.createdAt),
                        and(
                          eq(outboxEvents.createdAt, after.createdAt),
                          gt(outboxEvents.id, after.id)
                        )
                      )
                    : undefined
                )
              )
              .orderBy(outboxEvents.createdAt, outboxEvents.id)
              .limit(100)
          ),
        deleteExpiredEvent: (id, cutoff) =>
          execute('delete-expired-event', async (db) => {
            const rows = await db
              .delete(outboxEvents)
              .where(and(eq(outboxEvents.id, id), expired(cutoff)))
              .returning({ id: outboxEvents.id });
            return rows.length === 1;
          }),
        pendingEvents: (after) =>
          execute('pending-events', (db) =>
            db
              .select({ id: outboxEvents.id, createdAt: outboxEvents.createdAt })
              .from(outboxEvents)
              .where(
                and(
                  inArray(outboxEvents.subject, ['profile.created', 'profile.updated']),
                  isNull(outboxEvents.publishedAt),
                  after
                    ? or(
                        gt(outboxEvents.createdAt, after.createdAt),
                        and(
                          eq(outboxEvents.createdAt, after.createdAt),
                          gt(outboxEvents.id, after.id)
                        )
                      )
                    : undefined
                )
              )
              .orderBy(outboxEvents.createdAt, outboxEvents.id)
              .limit(100)
          ),
        markPublished: (id, now) =>
          execute('mark-published', async (db) => {
            await db
              .update(outboxEvents)
              .set({ publishedAt: now })
              .where(
                and(
                  eq(outboxEvents.id, id),
                  isNull(outboxEvents.publishedAt),
                  inArray(outboxEvents.subject, ['profile.created', 'profile.updated'])
                )
              );
          }),
      });
    })
  );
