import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CatalogOutbox, CatalogProjection, CatalogProjectionLayer, type ProjectionInput } from '../src/catalog/index.js';
import { CatalogPostgresLayer } from '../src/adapters/catalog/index.js';
import { Catalog } from '../src/delivery/index.js';

const wallpaper: ProjectionInput = {
  kind: 'wallpaper', occurrence: { source: 'ingestor', id: 'upload-1' }, occurredAt: '2026-01-01T00:00:00.000Z',
  wallpaper: { id: 'wlpr_one', storageBucket: 'wallpapers', storageKey: 'original', mimeType: 'image/jpeg', width: 1920, height: 1080, fileSizeBytes: 500, createdAt: '2026-01-01T00:00:00.000Z' },
};
describe('PostgreSQL catalog contract', () => {
  let container: Awaited<ReturnType<PostgreSqlContainer['start']>>;
  let pool: Pool;
  let runtime: ManagedRuntime.ManagedRuntime<Catalog | CatalogProjection | CatalogOutbox, unknown>;
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
    const postgres = CatalogPostgresLayer({ databaseUrl: container.getConnectionUri() });
    runtime = ManagedRuntime.make(Layer.mergeAll(postgres, CatalogProjectionLayer.pipe(Layer.provide(postgres))));
  });
  beforeEach(async () => { await pool.query('TRUNCATE catalog_processed, catalog_outbox, variants, wallpapers, profile_picture_assets, profile_picture_heads'); });
  afterAll(async () => { await runtime?.dispose(); await pool?.end(); await container?.stop(); });
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
  it('durably retains a variant arriving before its parent and publishes it once the parent arrives', async () => {
    const input: ProjectionInput = { kind: 'variant', occurrence: { source: 'generator', id: 'variant-early' }, occurredAt: '2026-01-01T00:00:01.000Z', variant: { wallpaperId: 'wlpr_late', storageBucket: 'wallpapers', storageKey: 'small', mimeType: 'image/jpeg', width: 640, height: 360, fileSizeBytes: 100, createdAt: '2026-01-01T00:00:01.000Z' } };
    await runtime.runPromise(Effect.gen(function* () {
      const projection = yield* CatalogProjection;
      const outbox = yield* CatalogOutbox;
      yield* projection.accept(input);
      expect(yield* outbox.listPending(10)).toEqual([]);
      if (wallpaper.kind !== 'wallpaper') throw new Error('invalid fixture');
      yield* projection.accept({ ...wallpaper, occurrence: { source: 'ingestor', id: 'upload-late' }, wallpaper: { ...wallpaper.wallpaper, id: 'wlpr_late' } });
      yield* projection.accept(input);
      const pending = yield* outbox.listPending(10);
      expect(pending).toHaveLength(2);
      expect(pending.map((entry) => entry.variant.width).sort((a, b) => a - b)).toEqual([640, 1920]);
      const catalog = yield* Catalog;
      expect(yield* catalog.findSmallestVariant('wlpr_late', 500, 300)).toMatchObject({ storageKey: 'small', width: 640 });
      expect(yield* catalog.findSmallestVariant('wlpr_late', 700, 300)).toBeNull();
      for (const entry of pending) yield* outbox.markPublished(entry.id);
      yield* projection.accept(input);
      expect(yield* outbox.listPending(10)).toEqual([]);
    }));
  });

  it('keeps the variant asset location and does not announce the same immutable target twice', async () => {
    await runtime.runPromise(Effect.gen(function* () {
      const projection = yield* CatalogProjection;
      yield* projection.accept(wallpaper);
      const setupOutbox = yield* CatalogOutbox;
      for (const entry of yield* setupOutbox.listPending(10)) yield* setupOutbox.markPublished(entry.id);
      const input: ProjectionInput = { kind: 'variant', occurrence: { source: 'generator', id: 'variant-other-bucket' }, occurredAt: '2026-01-01T00:00:01.000Z', variant: { wallpaperId: 'wlpr_one', storageBucket: 'variant-assets', storageKey: 'separate-bucket', mimeType: 'image/webp', width: 1280, height: 720, fileSizeBytes: 100, createdAt: '2026-01-01T00:00:01.000Z' } };
      yield* projection.accept(input);
      const catalog = yield* Catalog;
      expect(yield* catalog.findSmallestVariant('wlpr_one', 1000, 700)).toMatchObject({ storageBucket: 'variant-assets', storageKey: 'separate-bucket' });
      const outbox = yield* CatalogOutbox;
      const pending = yield* outbox.listPending(10);
      expect(pending).toHaveLength(1);
      for (const entry of pending) yield* outbox.markPublished(entry.id);
      yield* projection.accept({ ...input, occurrence: { source: 'generator', id: 'distinct-occurrence-same-target' } });
      expect(yield* outbox.listPending(10)).toEqual([]);
    }));
  });

});
