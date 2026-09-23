import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Effect, ManagedRuntime } from 'effect';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { postgresUploadsLayer } from '../src/adapters/postgres/index.js';
import { IngestionStore, type UploadRecord } from '../src/ingestion/index.js';
import { metadata } from './helpers/ingestion.js';

function record(id: string, owner = 'profile'): UploadRecord {
  const wallpaper = { id, profileId: owner, metadata, originalFilename: 'wallpaper.png', uploadedAt: '2026-01-01T00:00:00.000Z' };
  return { wallpaper, state: 'uploading', attempts: 0, leaseToken: `lease-${id}`, event: { id: `event-${id}`, source: 'wallpaperdb/ingestor', occurredAt: wallpaper.uploadedAt, correlationId: `workflow-${id}`, causationId: `command-${id}`, wallpaper } };
}

describe('PostgreSQL ingestion contract', () => {
  let container: StartedPostgreSqlContainer;
  let runtime: ManagedRuntime.ManagedRuntime<IngestionStore, unknown>;
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    const databaseUrl = container.getConnectionUri().replace('localhost', '127.0.0.1');
    const pool = new pg.Pool({ connectionString: databaseUrl });
    try { await migrate(drizzle(pool), { migrationsFolder: new URL('../drizzle', import.meta.url).pathname }); } finally { await pool.end(); }
    runtime = ManagedRuntime.make(postgresUploadsLayer({ databaseUrl }));
  }, 60_000);
  afterAll(async () => { await runtime?.dispose(); await container?.stop(); });

  it('atomically reserves concurrent same-owner content once, including unfinished uploads', async () => {
    const outcomes = await runtime.runPromise(IngestionStore.use((store) => Effect.all([
      store.reserve(record('wlpr_first'), new Date()), store.reserve(record('wlpr_second'), new Date()),
    ], { concurrency: 2 })));
    expect(outcomes.map((item) => item._tag).sort()).toEqual(['Existing', 'Reserved']);
    expect(new Set(outcomes.map((item) => item.record.wallpaper.id)).size).toBe(1);
  });
  it('rolls back stored state when its outbox occurrence cannot be committed', async () => {
    const first = record('wlpr_atomic_one', 'atomic-one');
    const second = record('wlpr_atomic_two', 'atomic-two');
    const collision = { ...second, event: { ...second.event, id: first.event.id } };
    await runtime.runPromise(IngestionStore.use((store) => Effect.gen(function* () {
      yield* store.reserve(first, new Date());
      yield* store.stored(first);
      yield* store.reserve(collision, new Date());
      const result = yield* store.stored(collision).pipe(Effect.result);
      expect(result._tag).toBe('Failure');
      expect((yield* store.reserve(collision, new Date())).record.state).toBe('uploading');
    })));
  });
  it('claims committed publication once across workers and preserves its occurrence after a retry', async () => {
    const original = record('wlpr_outbox', 'outbox-owner');
    const claimTime = new Date(Date.now() + 60_000);
    await runtime.runPromise(IngestionStore.use((store) => Effect.gen(function* () {
      yield* store.reserve(original, new Date(0));
      expect(yield* store.stored(original)).toBe(true);
      const claims = yield* Effect.all([store.claim(claimTime, claimTime, new Date(claimTime.getTime() + 60_000), 100), store.claim(claimTime, claimTime, new Date(claimTime.getTime() + 60_000), 100)], { concurrency: 2 });
      const claimed = claims.flat().filter((item) => item.wallpaper.id === original.wallpaper.id);
      expect(claimed).toHaveLength(1);
      const first = claimed[0];
      if (!first) throw new Error('Missing claimed upload');
      expect(first.event).toEqual(original.event);
      yield* store.defer(original, claimTime, 1);
      yield* store.defer(first, claimTime, 10);
      const later = new Date(claimTime.getTime() + 120_000);
      const retried = (yield* store.claim(later, later, later, 100)).find((item) => item.wallpaper.id === original.wallpaper.id);
      expect(retried?.attempts).toBe(1);
      expect(retried?.event).toEqual(original.event);
      if (!retried) throw new Error('Missing retry');
      yield* store.published(retried);
      expect((yield* store.claim(later, later, later, 100)).some((item) => item.wallpaper.id === original.wallpaper.id)).toBe(false);
    })));
  });
});
