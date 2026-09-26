import { createHash } from 'node:crypto';
import { recordCounter, recordHistogram } from '@wallpaperdb/core/telemetry';
import { and, asc, eq, gte, lt, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Context, Effect, Layer } from 'effect';
import { Pool } from 'pg';
import {
  CatalogFailure,
  CatalogOutbox,
  CatalogProjection,
  CatalogHealth,
  type AvailableNotification,
  type CatalogOutboxPort,
  type ProjectionInput,
  type CatalogProjectionPort,
} from '../../catalog/index.js';
import { Catalog, DeliveryUnavailable } from '../../delivery/index.js';
import {
  catalogOutbox,
  catalogProcessed,
  profilePictureAssets,
  profilePictureHeads,
  variants,
  wallpapers,
} from '../../db/schema.js';

export interface CatalogPostgresConfig {
  readonly databaseUrl: string;
}
class Database extends Context.Service<Database, ReturnType<typeof drizzle>>()(
  'media/catalog/Database'
) {}
const stableId = (parts: readonly string[]) =>
  createHash('sha256').update(JSON.stringify(parts)).digest('hex');
function notification(input: Exclude<ProjectionInput, { kind: 'profile' }>): AvailableNotification {
  const asset = input.kind === 'wallpaper' ? input.wallpaper : input.variant;
  return {
    id: stableId([input.occurrence.source, input.occurrence.id]),
    timestamp: input.occurredAt,
    causationId: input.occurrence.id,
    causationSource: input.occurrence.source,
    correlationId: input.correlationId,
    traceparent: input.traceparent,
    tracestate: input.tracestate,
    variant: {
      wallpaperId: input.kind === 'wallpaper' ? input.wallpaper.id : input.variant.wallpaperId,
      width: asset.width,
      height: asset.height,
      fileSizeBytes: asset.fileSizeBytes,
      format: asset.mimeType,
      createdAt: asset.createdAt,
    },
  };
}
const observeQuery =
  (table: string, operation: string) =>
  <A, E>(effect: Effect.Effect<A, E>) =>
    Effect.suspend(() => {
      const started = Date.now();
      return effect.pipe(
        Effect.tap((result) =>
          Effect.sync(() => {
            const attributes = { table, operation };
            recordCounter(
              'db.queries.total',
              1,
              operation.startsWith('find_')
                ? { ...attributes, found: String(result !== null) }
                : attributes
            );
            recordHistogram('db.query_duration_ms', Date.now() - started, attributes);
          })
        )
      );
    });
const observeProjection =
  (input: ProjectionInput) =>
  <E>(effect: Effect.Effect<void, E>) => {
    if (input.kind === 'profile') return effect;
    const original = input.kind === 'wallpaper';
    // Count successful projection transactions, including accepted replay no-ops.
    return effect.pipe(observeQuery(original ? 'wallpapers' : 'variants', original ? 'upsert' : 'insert'));
  };
const implementations = Layer.effectContext(
  Effect.gen(function* () {
    const db = yield* Database;
    const project: CatalogProjectionPort = {
      accept: (input) =>
        Effect.tryPromise({
          try: () =>
            db.transaction(async (tx) => {
              const inserted = await tx
                .insert(catalogProcessed)
                .values({ source: input.occurrence.source, occurrenceId: input.occurrence.id })
                .onConflictDoNothing()
                .returning();
              if (inserted.length === 0) return;
              if (input.kind === 'profile') {
                if (input.asset)
                  await tx
                    .insert(profilePictureAssets)
                    .values({
                      ...input.asset,
                      profileId: input.profile.id,
                      createdAt: new Date(input.asset.createdAt),
                    })
                    .onConflictDoNothing();
                const head = {
                  profileId: input.profile.id,
                  version: input.profile.version,
                  pictureId: input.profile.pictureId,
                  updatedAt: new Date(input.profile.updatedAt),
                };
                await tx
                  .insert(profilePictureHeads)
                  .values(head)
                  .onConflictDoUpdate({
                    target: profilePictureHeads.profileId,
                    set: head,
                    setWhere: lt(profilePictureHeads.version, input.profile.version),
                  });
                return;
              }
              if (input.kind === 'wallpaper') {
                const created = await tx
                  .insert(wallpapers)
                  .values({ ...input.wallpaper, createdAt: new Date(input.wallpaper.createdAt) })
                  .onConflictDoNothing()
                  .returning();
                if (created.length === 0) return;
              } else {
                const created = await tx
                  .insert(variants)
                  .values({
                    ...input.variant,
                    id: `var_${stableId([input.variant.wallpaperId, input.variant.storageBucket, input.variant.storageKey])}`,
                    createdAt: new Date(input.variant.createdAt),
                  })
                  .onConflictDoNothing()
                  .returning();
                if (created.length === 0) return;
              }
              const output = notification(input);
              await tx
                .insert(catalogOutbox)
                .values({
                  id: output.id,
                  wallpaperId: output.variant.wallpaperId,
                  notification: output,
                })
                .onConflictDoNothing();
            }),
          catch: (cause) => new CatalogFailure({ operation: 'commit', cause }),
        }).pipe(
          observeProjection(input),
          Effect.uninterruptible,
          Effect.tapError((error) => Effect.logError('Catalog projection failed', error)),
          Effect.withSpan('media.catalog.accept')
        ),
    };
    const outbox: CatalogOutboxPort = {
      listPending: (limit) =>
        Effect.tryPromise({
          try: async () => {
            const rows = await db
              .select({ notification: catalogOutbox.notification })
              .from(catalogOutbox)
              .innerJoin(wallpapers, eq(wallpapers.id, catalogOutbox.wallpaperId))
              .orderBy(asc(catalogOutbox.createdAt), asc(catalogOutbox.id))
              .limit(Math.max(1, Math.min(100, Math.floor(limit) || 1)));
            return rows.map((row) => row.notification);
          },
          catch: (cause) => new CatalogFailure({ operation: 'list-pending', cause }),
        }).pipe(
          Effect.tapError((error) => Effect.logError('Catalog outbox read failed', error)),
          Effect.withSpan('media.catalog.outbox.pending')
        ),
      markPublished: (id) =>
        Effect.tryPromise({
          try: async () => {
            await db.delete(catalogOutbox).where(eq(catalogOutbox.id, id));
          },
          catch: (cause) => new CatalogFailure({ operation: 'mark-published', cause }),
        }).pipe(
          Effect.tapError((error) =>
            Effect.logError('Catalog outbox acknowledgement failed', error)
          ),
          Effect.withSpan('media.catalog.outbox.published')
        ),
    };
    const catalog: Catalog = {
      findWallpaper: (id) =>
        Effect.tryPromise({
          try: async () =>
            (await db.select().from(wallpapers).where(eq(wallpapers.id, id)).limit(1))[0] ?? null,
          catch: (cause) => new DeliveryUnavailable({ operation: 'find-wallpaper', cause }),
        }).pipe(
          observeQuery('wallpapers', 'find_by_id'),
          Effect.tapError((error) => Effect.logError('Catalog read failed', error)),
          Effect.withSpan('media.catalog.find-wallpaper')
        ),
      findSmallestVariant: (id, minWidth, minHeight) =>
        Effect.tryPromise({
          try: async () =>
            (
              await db
                .select({
                  id: variants.id,
                  storageKey: variants.storageKey,
                  storageBucket: sql<string>`coalesce(${variants.storageBucket}, ${wallpapers.storageBucket})`,
                  width: variants.width,
                  height: variants.height,
                })
                .from(variants)
                .innerJoin(wallpapers, eq(wallpapers.id, variants.wallpaperId))
                .where(
                  and(
                    eq(variants.wallpaperId, id),
                    gte(variants.width, minWidth),
                    gte(variants.height, minHeight)
                  )
                )
                .orderBy(
                  sql`${variants.width}::bigint * ${variants.height}::bigint`,
                  asc(variants.id)
                )
                .limit(1)
            )[0] ?? null,
          catch: (cause) => new DeliveryUnavailable({ operation: 'find-variant', cause }),
        }).pipe(
          observeQuery('variants', 'find_smallest_suitable'),
          Effect.tapError((error) => Effect.logError('Catalog read failed', error)),
          Effect.withSpan('media.catalog.find-variant')
        ),
      findCurrentPicture: (id) =>
        Effect.tryPromise({
          try: async () =>
            (
              await db
                .select({ asset: profilePictureAssets })
                .from(profilePictureAssets)
                .innerJoin(
                  profilePictureHeads,
                  and(
                    eq(profilePictureHeads.pictureId, profilePictureAssets.id),
                    eq(profilePictureHeads.profileId, profilePictureAssets.profileId)
                  )
                )
                .where(eq(profilePictureAssets.id, id))
                .limit(1)
            )[0]?.asset ?? null,
          catch: (cause) => new DeliveryUnavailable({ operation: 'find-picture', cause }),
        }).pipe(
          Effect.tapError((error) => Effect.logError('Catalog read failed', error)),
          Effect.withSpan('media.catalog.find-picture')
        ),
    };
    return Context.make(CatalogProjection, project).pipe(
      Context.add(CatalogOutbox, outbox),
      Context.add(Catalog, catalog),
      Context.add(CatalogHealth, {
        check: Effect.tryPromise({
          try: () => db.execute(sql`SELECT 1`),
          catch: (cause) => new CatalogFailure({ operation: 'health', cause }),
        }).pipe(
          Effect.as(true),
          Effect.catch(() => Effect.succeed(false))
        ),
      })
    );
  })
);
export function CatalogPostgresLayer(config: CatalogPostgresConfig) {
  const database = Layer.effect(
    Database,
    Effect.gen(function* () {
      const pool = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const pool = new Pool({
            connectionString: config.databaseUrl,
            max: 10,
            connectionTimeoutMillis: 5000,
            statement_timeout: 10000,
            idle_in_transaction_session_timeout: 10000,
            query_timeout: 15000,
          });
          // Idle connections can fail outside a query. Handle the pool event so
          // the next health/read operation can report database unavailability.
          pool.on('error', (cause) => console.error('Catalog idle connection failed', cause));
          return pool;
        }),
        (pool) => Effect.promise(() => pool.end())
      );
      yield* Effect.tryPromise({
        try: () => pool.query('SELECT 1'),
        catch: (cause) => new CatalogFailure({ operation: 'connect', cause }),
      });
      return drizzle(pool);
    })
  );
  return implementations.pipe(Layer.provide(database));
}
