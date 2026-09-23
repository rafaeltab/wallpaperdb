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
});
