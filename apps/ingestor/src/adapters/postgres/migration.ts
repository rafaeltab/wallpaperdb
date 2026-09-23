import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import { z } from 'zod';
import { Effect } from 'effect';
import { IngestionUnavailable, type UploadedEvent } from '../../ingestion/index.js';

const legacyRow = z.object({
  id: z.string(),
  user_id: z.string(),
  content_hash: z.string(),
  upload_state: z.enum(['uploading', 'stored', 'processing', 'completed']),
  file_type: z.literal('image'),
  mime_type: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  file_size_bytes: z.coerce.number().int().positive(),
  original_filename: z.string(),
  storage_key: z.string().nullable(),
  uploaded_at: z.date(),
});
function occurrence(value: unknown): UploadedEvent {
  const row = legacyRow.parse(value);
  const defaultExtension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[
    row.mime_type
  ];
  const extension = row.storage_key?.match(/\/original\.([a-z0-9]+)$/)?.[1] ?? defaultExtension;
  return {
    id: `uploaded-${row.id}`,
    source: 'urn:wallpaperdb:ingestor',
    occurredAt: row.uploaded_at.toISOString(),
    correlationId: `ingestion-${row.id}`,
    causationId: `legacy-command-${row.id}`,
    wallpaper: {
      id: row.id,
      profileId: row.user_id,
      originalFilename: row.original_filename,
      uploadedAt: row.uploaded_at.toISOString(),
      metadata: {
        fileType: row.file_type,
        mimeType: row.mime_type,
        width: row.width,
        height: row.height,
        fileSizeBytes: row.file_size_bytes,
        contentHash: row.content_hash,
        extension,
      },
    },
  };
}

async function prepareLegacy(client: pg.PoolClient): Promise<void> {
  const exists = await client.query("SELECT to_regclass('public.wallpapers') AS relation");
  if (!exists.rows[0]?.relation) return;
  await validateCommitted(client);
  await client.query(`UPDATE wallpapers SET upload_state = 'failed', processing_error = 'Legacy upload metadata incomplete; retry upload', state_changed_at = NOW()
    WHERE upload_state IN ('initiated', 'uploading') AND
    (file_type IS DISTINCT FROM 'image' OR mime_type NOT IN ('image/jpeg', 'image/png', 'image/webp') OR mime_type IS NULL
      OR width IS NULL OR height IS NULL OR width <= 0 OR height <= 0 OR file_size_bytes IS NULL OR file_size_bytes <= 0
      OR original_filename IS NULL OR content_hash IS NULL)`);
  await client.query(`WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id, content_hash
      ORDER BY CASE WHEN upload_state IN ('stored', 'processing', 'completed') THEN 0 ELSE 1 END, uploaded_at, id) AS position
    FROM wallpapers WHERE content_hash IS NOT NULL AND upload_state <> 'failed'
  ) UPDATE wallpapers SET upload_state = 'failed', processing_error = 'Superseded legacy upload reservation', state_changed_at = NOW()
    FROM ranked WHERE wallpapers.id = ranked.id AND ranked.position > 1 AND wallpapers.upload_state IN ('initiated', 'uploading')`);
}

async function validateCommitted(client: pg.PoolClient): Promise<void> {
  let after: string | null = null;
  while (true) {
    const rows: pg.QueryResult<Record<string, unknown>> = await client.query(
      "SELECT * FROM wallpapers WHERE upload_state IN ('stored', 'processing', 'completed') AND ($1::text IS NULL OR id > $1) ORDER BY id LIMIT 100",
      [after]
    );
    for (const row of rows.rows) after = occurrence(row).wallpaper.id;
    if (rows.rows.length < 100) return;
  }
}

async function adoptLegacy(client: pg.PoolClient): Promise<void> {
  while (true) {
    await client.query('BEGIN');
    try {
      const rows = await client.query(
        "SELECT * FROM wallpapers WHERE ingestion_snapshot IS NULL AND upload_state IN ('uploading', 'stored', 'processing', 'completed') ORDER BY id LIMIT 100 FOR UPDATE"
      );
      for (const row of rows.rows) {
        const event = occurrence(row);
        await client.query(
          'UPDATE wallpapers SET ingestion_snapshot = $1, lease_token = $2, lease_expires_at = NULL WHERE id = $3',
          [event, `legacy-lease-${event.wallpaper.id}`, event.wallpaper.id]
        );
        if (row.upload_state === 'stored') {
          await client.query(
            'INSERT INTO upload_outbox(event_id, wallpaper_id, event) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
            [event.id, event.wallpaper.id, event]
          );
        }
      }
      await client.query('COMMIT');
      if (rows.rows.length < 100) break;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
}

/** Offline upgrade entry: stop old replicas first. Schema DDL remains Drizzle-generated. */
async function migrateDatabase(pool: pg.Pool, migrationsFolder: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('wallpaperdb.ingestor.migrate'))");
    await prepareLegacy(client);
    await migrate(drizzle(client), { migrationsFolder });
    await adoptLegacy(client);
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock(hashtext('wallpaperdb.ingestor.migrate'))");
    } finally {
      client.release();
    }
  }
}

export function migrateIngestionDatabase(
  pool: pg.Pool,
  migrationsFolder: string
): Effect.Effect<void, IngestionUnavailable> {
  return Effect.tryPromise({
    try: () => migrateDatabase(pool, migrationsFolder),
    catch: (cause) => new IngestionUnavailable({ operation: 'migrate', cause }),
  }).pipe(Effect.withSpan('ingestion.persistence.migrate'));
}
