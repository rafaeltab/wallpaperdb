import { and, eq, gt, inArray, isNull, isNotNull, lte, or } from 'drizzle-orm';
import { Effect, Layer } from 'effect';
import { handleClaims, outboxEvents, wallpaperOwnership } from '../../db/schema.js';
import { MaintenanceFailure, MaintenanceStore } from '../../maintenance/index.js';
import { Database, databaseDiagnostic } from '../database/index.js';

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
          catch: (cause) => new MaintenanceFailure({ operation, cause: databaseDiagnostic(cause) }),
        }).pipe(
          Effect.tapError((failure) =>
            Effect.logError('Profile maintenance persistence unavailable', {
              operation,
              cause: failure.cause,
            })
          ),
          Effect.withSpan(`profiles.maintenance-store.${operation}`)
        );
      return MaintenanceStore.of({
        dueAliases: (now, after) =>
          execute('due-aliases', async (db) => {
            const rows = await db
              .select({
                handle: handleClaims.handle,
                profileId: handleClaims.profileId,
                claimGeneration: handleClaims.claimGeneration,
                expiresAt: handleClaims.expiresAt,
              })
              .from(handleClaims)
              .where(
                and(
                  eq(handleClaims.kind, 'alias'),
                  lte(handleClaims.expiresAt, now),
                  after
                    ? or(
                        gt(handleClaims.expiresAt, after.expiresAt),
                        and(
                          eq(handleClaims.expiresAt, after.expiresAt),
                          gt(handleClaims.handle, after.handle)
                        )
                      )
                    : undefined
                )
              )
              .orderBy(handleClaims.expiresAt, handleClaims.handle)
              .limit(100);
            return rows.flatMap((row) =>
              row.expiresAt ? [{ ...row, expiresAt: row.expiresAt }] : []
            );
          }),
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
