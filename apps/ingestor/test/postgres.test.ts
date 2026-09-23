import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Effect, ManagedRuntime } from 'effect';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { postgresUploadsLayer } from '../src/adapters/postgres/index.js';
import { IngestionStore, type UploadRecord } from '../src/ingestion/index.js';
import { metadata } from './helpers/ingestion.js';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateIngestionDatabase } from '../src/adapters/postgres/index.js';

function record(id: string, owner = 'profile'): UploadRecord {
  const wallpaper = {
    id,
    profileId: owner,
    metadata,
    originalFilename: 'wallpaper.png',
    uploadedAt: '2026-01-01T00:00:00.000Z',
  };
  return {
    wallpaper,
    state: 'uploading',
    attempts: 0,
    leaseToken: `lease-${id}`,
    event: {
      id: `event-${id}`,
      source: 'urn:wallpaperdb:ingestor',
      occurredAt: wallpaper.uploadedAt,
      correlationId: `workflow-${id}`,
      causationId: `command-${id}`,
      wallpaper,
    },
  };
}

describe('PostgreSQL ingestion contract', () => {
  let container: StartedPostgreSqlContainer;
  let runtime: ManagedRuntime.ManagedRuntime<IngestionStore, unknown>;
  let databaseUrl: string;
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    databaseUrl = container.getConnectionUri().replace('localhost', '127.0.0.1');
    const pool = new pg.Pool({ connectionString: databaseUrl });
    try {
      await migrate(drizzle(pool), {
        migrationsFolder: new URL('../drizzle', import.meta.url).pathname,
      });
    } finally {
      await pool.end();
    }
    runtime = ManagedRuntime.make(postgresUploadsLayer({ databaseUrl }));
  }, 60_000);
  afterAll(async () => {
    await runtime?.dispose();
    await container?.stop();
  });

  it('requires repair of incomplete stored originals before upgrading legacy records without duplicate occurrences', async () => {
    const admin = new pg.Pool({ connectionString: databaseUrl });
    await admin.query('CREATE DATABASE legacy_ingestion');
    await admin.end();
    const url = new URL(databaseUrl);
    url.pathname = '/legacy_ingestion';
    const pool = new pg.Pool({ connectionString: url.toString() });
    const initial = await mkdtemp(join(tmpdir(), 'ingestor-migration-'));
    const migrationsFolder = new URL('../drizzle', import.meta.url).pathname;
    try {
      await mkdir(join(initial, 'meta'));
      const journal = JSON.parse(
        await readFile(join(migrationsFolder, 'meta/_journal.json'), 'utf8')
      );
      await writeFile(
        join(initial, 'meta/_journal.json'),
        JSON.stringify({ ...journal, entries: journal.entries.slice(0, 1) })
      );
      await writeFile(
        join(initial, '0000_left_starjammers.sql'),
        await readFile(join(migrationsFolder, '0000_left_starjammers.sql'))
      );
      await migrate(drizzle(pool), { migrationsFolder: initial });
      for (const [id, owner, state] of [
        ['legacy-stored', 'owner', 'stored'],
        ['legacy-duplicate', 'owner', 'uploading'],
        ['legacy-completed', 'other', 'completed'],
      ]) {
        await pool.query(
          `INSERT INTO wallpapers(id, user_id, content_hash, upload_state, file_type, mime_type, width, height, file_size_bytes, original_filename, storage_key) VALUES ($1,$2,'hash',$3,'image','image/png',1920,1080,3,'legacy.png',$4)`,
          [id, owner, state, `${id}/original.png`]
        );
      }
      await pool.query(
        "INSERT INTO wallpapers(id,user_id,upload_state) VALUES ('legacy-interrupted','owner','uploading')"
      );
      await pool.query(
        "INSERT INTO wallpapers(id,user_id,upload_state) VALUES ('legacy-incomplete-stored','repair-owner','stored')"
      );
      const rejected = await Effect.runPromise(
        migrateIngestionDatabase(pool, migrationsFolder).pipe(Effect.result)
      );
      expect(rejected._tag).toBe('Failure');
      const unchanged = await pool.query(
        "SELECT id, upload_state FROM wallpapers WHERE id IN ('legacy-incomplete-stored', 'legacy-interrupted', 'legacy-duplicate') ORDER BY id"
      );
      expect(unchanged.rows).toEqual([
        { id: 'legacy-duplicate', upload_state: 'uploading' },
        { id: 'legacy-incomplete-stored', upload_state: 'stored' },
        { id: 'legacy-interrupted', upload_state: 'uploading' },
      ]);
      expect(
        (await pool.query("SELECT to_regclass('public.upload_outbox') AS relation")).rows
      ).toEqual([{ relation: null }]);
      await pool.query(
        "UPDATE wallpapers SET content_hash = 'repaired-hash', file_type = 'image', mime_type = 'image/png', width = 1920, height = 1080, file_size_bytes = 3, original_filename = 'legacy.png', storage_key = 'legacy-incomplete-stored/original.png' WHERE id = 'legacy-incomplete-stored'"
      );
      await Effect.runPromise(migrateIngestionDatabase(pool, migrationsFolder));
      await Effect.runPromise(migrateIngestionDatabase(pool, migrationsFolder));
      const rows = await pool.query(
        'SELECT id, upload_state, ingestion_snapshot FROM wallpapers ORDER BY id'
      );
      expect(rows.rows.find((row) => row.id === 'legacy-stored')?.upload_state).toBe('stored');
      expect(rows.rows.find((row) => row.id === 'legacy-incomplete-stored')?.upload_state).toBe(
        'stored'
      );
      expect(rows.rows.find((row) => row.id === 'legacy-completed')?.upload_state).toBe(
        'completed'
      );
      expect(rows.rows.find((row) => row.id === 'legacy-duplicate')?.upload_state).toBe('failed');
      expect(rows.rows.find((row) => row.id === 'legacy-interrupted')?.upload_state).toBe('failed');
      const outbox = await pool.query('SELECT event_id, event FROM upload_outbox');
      expect(outbox.rows).toHaveLength(2);
      expect(outbox.rows[0]?.event.source).toBe('urn:wallpaperdb:ingestor');
      expect(outbox.rows[0]?.event.wallpaper.metadata.extension).toBe('png');
    } finally {
      await pool.end();
      await rm(initial, { recursive: true, force: true });
    }
  });

  it('atomically reserves concurrent same-owner content once, including unfinished uploads', async () => {
    const outcomes = await runtime.runPromise(
      IngestionStore.use((store) =>
        Effect.all(
          [
            store.reserve(record('wlpr_first'), new Date()),
            store.reserve(record('wlpr_second'), new Date()),
          ],
          { concurrency: 2 }
        )
      )
    );
    expect(outcomes.map((item) => item._tag).sort()).toEqual(['Existing', 'Reserved']);
    expect(new Set(outcomes.map((item) => item.record.wallpaper.id)).size).toBe(1);
  });
  it('enforces complete committed image metadata against external database writes', async () => {
    const candidate = record('wlpr_constraint', 'constraint-owner');
    await runtime.runPromise(
      IngestionStore.use((store) =>
        Effect.gen(function* () {
          yield* store.reserve(candidate, new Date());
          yield* store.stored(candidate);
        })
      )
    );
    const pool = new pg.Pool({ connectionString: databaseUrl });
    try {
      await expect(
        pool.query("UPDATE wallpapers SET width = NULL WHERE id = 'wlpr_constraint'")
      ).rejects.toMatchObject({ code: '23514' });
    } finally {
      await pool.end();
    }
  });
  it('rolls back stored state when its outbox occurrence cannot be committed', async () => {
    const first = record('wlpr_atomic_one', 'atomic-one');
    const second = record('wlpr_atomic_two', 'atomic-two');
    const collision = { ...second, event: { ...second.event, id: first.event.id } };
    await runtime.runPromise(
      IngestionStore.use((store) =>
        Effect.gen(function* () {
          yield* store.reserve(first, new Date());
          yield* store.stored(first);
          yield* store.reserve(collision, new Date());
          const result = yield* store.stored(collision).pipe(Effect.result);
          expect(result._tag).toBe('Failure');
          expect((yield* store.reserve(collision, new Date())).record.state).toBe('uploading');
        })
      )
    );
  });
  it('releases failed upload content for a retry and quarantines exhausted committed publications', async () => {
    const failed = record('wlpr_failed', 'failed-owner');
    const quarantined = record('wlpr_quarantined', 'quarantined-owner');
    await runtime.runPromise(
      IngestionStore.use((store) =>
        Effect.gen(function* () {
          yield* store.reserve(failed, new Date());
          yield* store.defer(failed, new Date(), 1);
          expect(yield* store.assetDisposition(failed.wallpaper.id)).toBe('remove');
          expect(
            (yield* store.reserve(record('wlpr_replacement', 'failed-owner'), new Date()))._tag
          ).toBe('Reserved');
          yield* store.reserve(quarantined, new Date());
          yield* store.stored(quarantined);
          yield* store.defer({ ...quarantined, state: 'stored', attempts: 9 }, new Date(), 10);
          const later = new Date(Date.now() + 3600_000);
          expect(
            (yield* store.claim(later, later, later, 100)).some(
              (entry) => entry.wallpaper.id === quarantined.wallpaper.id
            )
          ).toBe(false);
          expect(yield* store.assetDisposition(quarantined.wallpaper.id)).toBe('retain');
          expect(yield* store.assetDisposition('does-not-exist')).toBe('remove');
        })
      )
    );
  });
  it('rejects stale transitions and obeys active leases and batch bounds', async () => {
    const candidate = record('wlpr_leased', 'leased-owner');
    const later = new Date(Date.now() + 3600_000);
    await runtime.runPromise(
      IngestionStore.use((store) =>
        Effect.gen(function* () {
          yield* store.reserve(candidate, later);
          expect(yield* store.stored({ ...candidate, leaseToken: 'other-worker' })).toBe(false);
          expect(
            (yield* store.claim(new Date(), later, later, 1)).some(
              (entry) => entry.wallpaper.id === candidate.wallpaper.id
            )
          ).toBe(false);
          expect((yield* store.claim(later, later, later, 1)).length).toBeLessThanOrEqual(1);
          yield* store.published(candidate);
          expect((yield* store.reserve(candidate, later)).record.state).toBe('uploading');
          yield* store.expireIntents(later);
        })
      )
    );
  });
  it('claims committed publication once across workers and preserves its occurrence after a retry', async () => {
    const draft = record('wlpr_outbox', 'outbox-owner');
    const original = {
      ...draft,
      event: {
        ...draft.event,
        traceContext: { traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01' },
      },
    };
    const claimTime = new Date(Date.now() + 60_000);
    await runtime.runPromise(
      IngestionStore.use((store) =>
        Effect.gen(function* () {
          yield* store.reserve(original, new Date(0));
          expect(yield* store.stored(original)).toBe(true);
          const claims = yield* Effect.all(
            [
              store.claim(claimTime, claimTime, new Date(claimTime.getTime() + 60_000), 100),
              store.claim(claimTime, claimTime, new Date(claimTime.getTime() + 60_000), 100),
            ],
            { concurrency: 2 }
          );
          const claimed = claims
            .flat()
            .filter((item) => item.wallpaper.id === original.wallpaper.id);
          expect(claimed).toHaveLength(1);
          const first = claimed[0];
          if (!first) throw new Error('Missing claimed upload');
          expect(first.event).toEqual(original.event);
          yield* store.defer(original, claimTime, 1);
          yield* store.defer(first, claimTime, 10);
          const later = new Date(claimTime.getTime() + 120_000);
          const retried = (yield* store.claim(later, later, later, 100)).find(
            (item) => item.wallpaper.id === original.wallpaper.id
          );
          expect(retried?.attempts).toBe(1);
          expect(retried?.event).toEqual(original.event);
          if (!retried) throw new Error('Missing retry');
          yield* store.published(retried);
          expect(
            (yield* store.claim(later, later, later, 100)).some(
              (item) => item.wallpaper.id === original.wallpaper.id
            )
          ).toBe(false);
        })
      )
    );
  });
});
