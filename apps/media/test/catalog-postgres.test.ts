import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CatalogOutbox, CatalogProjection, CatalogProjectionLayer, type ProjectionInput } from '../src/catalog/index.js';
import { CatalogPostgresLayer } from '../src/adapters/catalog/index.js';
import { Catalog } from '../src/delivery/index.js';

const wallpaper: ProjectionInput = {
  kind: 'wallpaper', occurrence: { source: 'ingestor', id: 'upload-1' }, occurredAt: '2026-01-01T00:00:00.000Z',
  wallpaper: { id: 'wlpr_one', storageBucket: 'wallpapers', storageKey: 'original', mimeType: 'image/jpeg', width: 1920, height: 1080, fileSizeBytes: 500, createdAt: '2026-01-01T00:00:00.000Z' },
};
describe('PostgreSQL catalog contract', () => {
  let container: Awaited<ReturnType<PostgreSqlContainer['start']>>;
  let runtime: ManagedRuntime.ManagedRuntime<Catalog | CatalogProjection | CatalogOutbox, unknown>;
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    const pool = new Pool({ connectionString: container.getConnectionUri() });
    try { await migrate(drizzle(pool), { migrationsFolder: './drizzle' }); } finally { await pool.end(); }
    const postgres = CatalogPostgresLayer({ databaseUrl: container.getConnectionUri() });
    runtime = ManagedRuntime.make(Layer.mergeAll(postgres, CatalogProjectionLayer.pipe(Layer.provide(postgres))));
  });
  afterAll(async () => { await runtime?.dispose(); await container?.stop(); });
  it('atomically accepts duplicate uploads once and retains a stable notification until acknowledgement', async () => {
    await runtime.runPromise(Effect.gen(function* () {
      const projection = yield* CatalogProjection;
      yield* Effect.all([projection.accept(wallpaper), projection.accept(wallpaper)], { concurrency: 2 });
      const catalog = yield* Catalog;
      expect(yield* catalog.findWallpaper('wlpr_one')).toMatchObject({ storageKey: 'original', width: 1920 });
      const outbox = yield* CatalogOutbox;
      const first = yield* outbox.listPending(10);
      expect(first).toHaveLength(1);
      expect(first[0]).toMatchObject({ timestamp: '2026-01-01T00:00:00.000Z', causationId: 'upload-1', causationSource: 'ingestor', variant: { wallpaperId: 'wlpr_one', format: 'image/jpeg' } });
      expect(yield* outbox.listPending(10)).toEqual(first);
      for (const notification of first) yield* outbox.markPublished(notification.id);
      yield* projection.accept(wallpaper);
      expect(yield* outbox.listPending(10)).toEqual([]);
    }));
  });
});
