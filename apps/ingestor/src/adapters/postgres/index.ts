import { and, eq, isNotNull, isNull, lt, lte, ne, or } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Context, Effect, Layer } from 'effect';
import pg from 'pg';
import { ulid } from 'ulid';
import { z } from 'zod';
import * as schema from '../../db/schema.js';
import {
  IngestionStore,
  IngestionUnavailable,
  type UploadRecord,
  type Reservation,
} from '../../ingestion/index.js';

const { wallpapers, uploadOutbox } = schema;
const metadataSchema = z.object({
  fileType: z.literal('image'),
  mimeType: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fileSizeBytes: z.number().int().positive(),
  contentHash: z.string().min(1),
  extension: z.string().regex(/^[a-z0-9]+$/),
});
const snapshotSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  occurredAt: z.string().datetime(),
  correlationId: z.string().min(1),
  causationId: z.string().min(1),
  wallpaper: z.object({
    id: z.string().min(1),
    profileId: z.string().min(1),
    metadata: metadataSchema,
    originalFilename: z.string(),
    uploadedAt: z.string().datetime(),
  }),
});
const persistedSchema = z.object({
  ingestionSnapshot: snapshotSchema,
  uploadState: z.enum(['uploading', 'stored', 'processing', 'completed', 'failed']),
  uploadAttempts: z.number().int().nonnegative(),
  leaseToken: z.string().min(1),
});
function fromRow(row: unknown): UploadRecord {
  const value = persistedSchema.parse(row);
  return {
    wallpaper: value.ingestionSnapshot.wallpaper,
    event: value.ingestionSnapshot,
    state: value.uploadState,
    attempts: value.uploadAttempts,
    leaseToken: value.leaseToken,
  };
}
type Database = ReturnType<typeof drizzle<typeof schema>>;

export interface PostgresUploads {
  check(): Effect.Effect<boolean>;
}
export const PostgresUploads = Context.Service<PostgresUploads>('wallpaperdb.ingestor.postgres');
const PostgresResource = Context.Service<PostgresUploads & { readonly store: IngestionStore }>(
  'wallpaperdb.ingestor.postgres.resource'
);

function operation<A>(name: string, run: () => Promise<A>): Effect.Effect<A, IngestionUnavailable> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => new IngestionUnavailable({ operation: name, cause }),
  }).pipe(
    Effect.tapError((error) =>
      Effect.logError('Ingestion persistence failed', { operation: name, cause: error.cause })
    ),
    Effect.withSpan(`ingestion.persistence.${name}`)
  );
}
function owned(record: UploadRecord) {
  return and(
    eq(wallpapers.id, record.wallpaper.id),
    eq(wallpapers.leaseToken, record.leaseToken),
    eq(wallpapers.uploadState, record.state)
  );
}

class PostgresIngestionStore implements IngestionStore {
  constructor(private readonly db: Database) {}

  reserve = (
    record: UploadRecord,
    leaseUntil: Date
  ): Effect.Effect<Reservation, IngestionUnavailable> =>
    operation('reserve', () =>
      this.db.transaction(async (tx) => {
        const { wallpaper } = record;
        const { metadata } = wallpaper;
        const inserted = await tx
          .insert(wallpapers)
          .values({
            id: wallpaper.id,
            userId: wallpaper.profileId,
            contentHash: metadata.contentHash,
            uploadState: 'uploading',
            uploadAttempts: 0,
            ingestionSnapshot: record.event,
            leaseToken: record.leaseToken,
            leaseExpiresAt: leaseUntil,
            fileType: metadata.fileType,
            mimeType: metadata.mimeType,
            width: metadata.width,
            height: metadata.height,
            fileSizeBytes: metadata.fileSizeBytes,
            aspectRatio: (metadata.width / metadata.height).toFixed(4),
            originalFilename: wallpaper.originalFilename,
            uploadedAt: new Date(wallpaper.uploadedAt),
          })
          .onConflictDoNothing()
          .returning();
        if (inserted[0]) return { _tag: 'Reserved', record: fromRow(inserted[0]) };
        const existing = await tx
          .select()
          .from(wallpapers)
          .where(
            and(
              eq(wallpapers.userId, wallpaper.profileId),
              eq(wallpapers.contentHash, metadata.contentHash),
              ne(wallpapers.uploadState, 'failed')
            )
          )
          .limit(1);
        if (!existing[0]) throw new Error('Reservation conflict without an active upload');
        return { _tag: 'Existing', record: fromRow(existing[0]) };
      })
    );

  stored = (record: UploadRecord) =>
    operation('stored', () =>
      this.db.transaction(async (tx) => {
        const updated = await tx
          .update(wallpapers)
          .set({ uploadState: 'stored', uploadAttempts: 0, stateChangedAt: new Date() })
          .where(and(owned(record), eq(wallpapers.uploadState, 'uploading')))
          .returning({ id: wallpapers.id });
        if (!updated.length) return false;
        await tx
          .insert(uploadOutbox)
          .values({
            eventId: record.event.id,
            wallpaperId: record.wallpaper.id,
            event: record.event,
          })
          .onConflictDoNothing();
        return true;
      })
    );

  published = (record: UploadRecord) =>
    operation('published', () =>
      this.db.transaction(async (tx) => {
        const updated = await tx
          .update(wallpapers)
          .set({ uploadState: 'processing', stateChangedAt: new Date(), leaseExpiresAt: null })
          .where(
            and(
              eq(wallpapers.id, record.wallpaper.id),
              eq(wallpapers.leaseToken, record.leaseToken),
              eq(wallpapers.uploadState, 'stored')
            )
          )
          .returning({ id: wallpapers.id });
        if (!updated.length) return;
        await tx
          .update(uploadOutbox)
          .set({ publishedAt: new Date() })
          .where(eq(uploadOutbox.eventId, record.event.id));
      })
    );

  defer = (record: UploadRecord, now: Date, maxAttempts: number) =>
    operation('defer', () =>
      this.db.transaction(async (tx) => {
        const attempts = record.attempts + 1;
        const exhausted = attempts >= maxAttempts;
        const updated = await tx
          .update(wallpapers)
          .set({
            uploadAttempts: attempts,
            uploadState: exhausted && record.state === 'uploading' ? 'failed' : record.state,
            processingError: exhausted ? 'Recovery attempts exhausted' : null,
            stateChangedAt: now,
            leaseExpiresAt: null,
          })
          .where(owned(record))
          .returning({ id: wallpapers.id });
        if (updated.length && exhausted && record.state === 'stored') {
          await tx
            .update(uploadOutbox)
            .set({ quarantinedAt: now })
            .where(eq(uploadOutbox.eventId, record.event.id));
        }
      })
    );

  claim = (now: Date, staleBefore: Date, leaseUntil: Date, limit: number) =>
    operation('claim', () =>
      this.db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(wallpapers)
          .where(
            and(
              or(
                and(eq(wallpapers.uploadState, 'uploading'), lt(wallpapers.uploadAttempts, 3)),
                and(eq(wallpapers.uploadState, 'stored'), lt(wallpapers.uploadAttempts, 10))
              ),
              isNotNull(wallpapers.ingestionSnapshot),
              lt(wallpapers.stateChangedAt, staleBefore),
              or(isNull(wallpapers.leaseExpiresAt), lte(wallpapers.leaseExpiresAt, now))
            )
          )
          .limit(Math.max(1, Math.min(100, limit)))
          .for('update', { skipLocked: true });
        const claimed: UploadRecord[] = [];
        for (const row of rows) {
          const leaseToken = ulid();
          await tx
            .update(wallpapers)
            .set({ leaseToken, leaseExpiresAt: leaseUntil })
            .where(eq(wallpapers.id, row.id));
          claimed.push(fromRow({ ...row, leaseToken }));
        }
        return claimed;
      })
    );

  expireIntents = (before: Date) =>
    operation('expire-intents', async () => {
      await this.db
        .delete(wallpapers)
        .where(and(eq(wallpapers.uploadState, 'initiated'), lt(wallpapers.stateChangedAt, before)));
    });

  assetDisposition = (id: string): Effect.Effect<'retain' | 'remove', IngestionUnavailable> =>
    operation('asset-disposition', async () => {
      const rows = await this.db
        .select({ id: wallpapers.id })
        .from(wallpapers)
        .where(and(eq(wallpapers.id, id), ne(wallpapers.uploadState, 'failed')))
        .limit(1);
      return rows.length ? 'retain' : 'remove';
    });
}

export function postgresUploadsLayer(config: { readonly databaseUrl: string }) {
  const resource = Layer.effect(
    PostgresResource,
    Effect.gen(function* () {
      const pool = yield* Effect.acquireRelease(
        Effect.sync(
          () =>
            new pg.Pool({
              connectionString: config.databaseUrl,
              max: 5,
              connectionTimeoutMillis: 5_000,
              statement_timeout: 5_000,
              query_timeout: 5_000,
            })
        ),
        (pool) =>
          Effect.promise(() => pool.end()).pipe(
            Effect.catchCause((cause) => Effect.logError('PostgreSQL shutdown failed', cause))
          )
      );
      yield* operation('connect', () => pool.query('SELECT 1'));
      const store = new PostgresIngestionStore(drizzle(pool, { schema }));
      return {
        store,
        check: () =>
          operation('health', () => pool.query('SELECT 1')).pipe(
            Effect.as(true),
            Effect.catchTag('IngestionUnavailable', () => Effect.succeed(false))
          ),
      };
    })
  );
  return Layer.mergeAll(
    Layer.effect(
      IngestionStore,
      PostgresResource.use((resource) => Effect.succeed(resource.store))
    ),
    Layer.effect(
      PostgresUploads,
      PostgresResource.use((resource) => Effect.succeed({ check: resource.check }))
    )
  ).pipe(Layer.provide(resource));
}
