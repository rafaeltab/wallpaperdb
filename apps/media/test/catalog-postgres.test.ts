import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Effect, ManagedRuntime } from 'effect';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CatalogOutbox, CatalogProjection, type ProjectionInput } from '../src/catalog/index.js';
import { CatalogPostgresLayer } from '../src/adapters/catalog/index.js';
import { Catalog } from '../src/delivery/index.js';
import { wallpapers, variants } from '../src/db/schema.js';

const wallpaper: ProjectionInput = {
  kind: 'wallpaper',
  occurrence: { source: 'ingestor', id: 'upload-1' },
  occurredAt: '2026-01-01T00:00:00.000Z',
  wallpaper: {
    id: 'wlpr_one',
    storageBucket: 'wallpapers',
    storageKey: 'original',
    mimeType: 'image/jpeg',
    width: 1920,
    height: 1080,
    fileSizeBytes: 500,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
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
    runtime = ManagedRuntime.make(postgres);
  });
  beforeEach(async () => {
    await pool.query(
      'TRUNCATE catalog_targets, catalog_processed, catalog_outbox, variants, wallpapers, profile_picture_assets, profile_picture_heads'
    );
  });
  afterAll(async () => {
    await runtime?.dispose();
    await pool?.end();
    await container?.stop();
  });
  it('atomically accepts duplicate uploads once and retains a stable notification until acknowledgement', async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const projection = yield* CatalogProjection;
        yield* Effect.all([projection.accept(wallpaper), projection.accept(wallpaper)], {
          concurrency: 2,
        });
        const catalog = yield* Catalog;
        expect(yield* catalog.findWallpaper('wlpr_one')).toMatchObject({
          storageKey: 'original',
          width: 1920,
        });
        const outbox = yield* CatalogOutbox;
        const first = yield* outbox.listPending(10);
        expect(first).toHaveLength(1);
        expect(first[0]).toMatchObject({
          timestamp: '2026-01-01T00:00:00.000Z',
          causationId: 'upload-1',
          causationSource: 'ingestor',
          variant: { wallpaperId: 'wlpr_one', format: 'image/jpeg' },
        });
        expect(yield* outbox.listPending(10)).toEqual(first);
        for (const notification of first) yield* outbox.markPublished(notification.id);
        yield* projection.accept(wallpaper);
        expect(yield* outbox.listPending(10)).toEqual([]);
      })
    );
  });
  it('durably retains a variant arriving before its parent and publishes it once the parent arrives', async () => {
    const input: ProjectionInput = {
      kind: 'variant',
      occurrence: { source: 'generator', id: 'variant-early' },
      occurredAt: '2026-01-01T00:00:01.000Z',
      variant: {
        wallpaperId: 'wlpr_late',
        storageBucket: 'wallpapers',
        storageKey: 'small',
        mimeType: 'image/jpeg',
        width: 640,
        height: 360,
        fileSizeBytes: 100,
        createdAt: '2026-01-01T00:00:01.000Z',
      },
    };
    await runtime.runPromise(
      Effect.gen(function* () {
        const projection = yield* CatalogProjection;
        const outbox = yield* CatalogOutbox;
        yield* projection.accept(input);
        expect(yield* outbox.listPending(10)).toEqual([]);
        if (wallpaper.kind !== 'wallpaper') throw new Error('invalid fixture');
        yield* projection.accept({
          ...wallpaper,
          occurrence: { source: 'ingestor', id: 'upload-late' },
          wallpaper: { ...wallpaper.wallpaper, id: 'wlpr_late' },
        });
        yield* projection.accept(input);
        const pending = yield* outbox.listPending(10);
        expect(pending).toHaveLength(2);
        expect(pending.map((entry) => entry.variant.width).sort((a, b) => a - b)).toEqual([
          640, 1920,
        ]);
        const catalog = yield* Catalog;
        expect(yield* catalog.findSmallestVariant('wlpr_late', 500, 300)).toMatchObject({
          storageKey: 'small',
          width: 640,
        });
        expect(yield* catalog.findSmallestVariant('wlpr_late', 700, 300)).toBeNull();
        for (const entry of pending) yield* outbox.markPublished(entry.id);
        yield* projection.accept(input);
        expect(yield* outbox.listPending(10)).toEqual([]);
      })
    );
  });

  it('keeps the variant asset location and does not announce the same immutable target twice', async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const projection = yield* CatalogProjection;
        yield* projection.accept(wallpaper);
        const setupOutbox = yield* CatalogOutbox;
        for (const entry of yield* setupOutbox.listPending(10))
          yield* setupOutbox.markPublished(entry.id);
        const input: ProjectionInput = {
          kind: 'variant',
          occurrence: { source: 'generator', id: 'variant-other-bucket' },
          occurredAt: '2026-01-01T00:00:01.000Z',
          variant: {
            wallpaperId: 'wlpr_one',
            storageBucket: 'variant-assets',
            storageKey: 'separate-bucket',
            mimeType: 'image/webp',
            width: 1280,
            height: 720,
            fileSizeBytes: 100,
            createdAt: '2026-01-01T00:00:01.000Z',
          },
        };
        yield* projection.accept(input);
        const catalog = yield* Catalog;
        expect(yield* catalog.findSmallestVariant('wlpr_one', 1000, 700)).toMatchObject({
          storageBucket: 'variant-assets',
          storageKey: 'separate-bucket',
        });
        const outbox = yield* CatalogOutbox;
        const pending = yield* outbox.listPending(10);
        expect(pending).toHaveLength(1);
        for (const entry of pending) yield* outbox.markPublished(entry.id);
        yield* projection.accept({
          ...input,
          occurrence: { source: 'generator', id: 'distinct-occurrence-same-target' },
        });
        expect(yield* outbox.listPending(10)).toEqual([]);
      })
    );
  });

  it('projects late asset metadata without rolling back a newer profile snapshot', async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const projection = yield* CatalogProjection;
        const catalog = yield* Catalog;
        const current: ProjectionInput = {
          kind: 'profile',
          occurrence: { source: 'users', id: 'profile-v3' },
          occurredAt: '2026-01-03T00:00:00.000Z',
          profile: {
            id: 'profile-one',
            version: 3,
            pictureId: 'picture-new',
            updatedAt: '2026-01-03T00:00:00.000Z',
          },
        };
        yield* projection.accept(current);
        expect(yield* catalog.findCurrentPicture('picture-new')).toBeNull();
        yield* projection.accept({
          ...current,
          occurrence: { source: 'users', id: 'profile-v2' },
          profile: { ...current.profile, version: 2 },
          asset: {
            id: 'picture-new',
            storageBucket: 'pictures',
            storageKey: 'new',
            mimeType: 'image/webp',
            width: 256,
            height: 256,
            fileSizeBytes: 100,
            createdAt: '2026-01-02T00:00:00.000Z',
          },
        });
        expect(yield* catalog.findCurrentPicture('picture-new')).toMatchObject({
          storageKey: 'new',
        });
        yield* projection.accept({
          ...current,
          occurrence: { source: 'users', id: 'profile-v1' },
          profile: { ...current.profile, version: 1, pictureId: 'picture-old' },
          asset: {
            id: 'picture-old',
            storageBucket: 'pictures',
            storageKey: 'old',
            mimeType: 'image/webp',
            width: 256,
            height: 256,
            fileSizeBytes: 100,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        });
        expect(yield* catalog.findCurrentPicture('picture-old')).toBeNull();
        expect(yield* catalog.findCurrentPicture('picture-new')).toMatchObject({
          storageKey: 'new',
        });
        yield* projection.accept({
          ...current,
          occurrence: { source: 'users', id: 'profile-v4' },
          profile: { ...current.profile, version: 4, pictureId: null },
        });
        expect(yield* catalog.findCurrentPicture('picture-new')).toBeNull();
        yield* projection.accept(current);
        expect(yield* catalog.findCurrentPicture('picture-new')).toBeNull();
      })
    );
  });
  it('rolls back the processed occurrence when persistence fails so the input can be retried', async () => {
    if (wallpaper.kind !== 'wallpaper') throw new Error('invalid fixture');
    const invalid: ProjectionInput = {
      ...wallpaper,
      wallpaper: { ...wallpaper.wallpaper, width: 2147483648 },
    };
    const failure = await runtime.runPromise(
      Effect.gen(function* () {
        const projection = yield* CatalogProjection;
        return yield* projection.accept(invalid).pipe(Effect.flip);
      })
    );
    expect(failure._tag).toBe('CatalogFailure');
    await runtime.runPromise(
      Effect.gen(function* () {
        const catalog = yield* Catalog;
        const outbox = yield* CatalogOutbox;
        expect(yield* catalog.findWallpaper('wlpr_one')).toBeNull();
        expect(yield* outbox.listPending(10)).toEqual([]);
        const projection = yield* CatalogProjection;
        yield* projection.accept(wallpaper);
        expect(yield* catalog.findWallpaper('wlpr_one')).toMatchObject({ width: 1920 });
        expect(yield* outbox.listPending(10)).toHaveLength(1);
      })
    );
  });

  it('selects the smallest area meeting both dimensions without integer overflow', async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const projection = yield* CatalogProjection;
        const catalog = yield* Catalog;
        yield* projection.accept(wallpaper);
        const choices = [
          { storageKey: 'too-short', width: 80000, height: 100 },
          { storageKey: 'too-narrow', width: 100, height: 80000 },
          { storageKey: 'large', width: 70000, height: 70000 },
          { storageKey: 'small', width: 50000, height: 50000 },
        ];
        for (const choice of choices)
          yield* projection.accept({
            kind: 'variant',
            occurrence: { source: 'generator', id: choice.storageKey },
            occurredAt: '2026-01-01T00:00:01.000Z',
            variant: {
              wallpaperId: 'wlpr_one',
              storageBucket: 'wallpapers',
              mimeType: 'image/jpeg',
              fileSizeBytes: 100,
              createdAt: '2026-01-01T00:00:01.000Z',
              ...choice,
            },
          });
        expect(yield* catalog.findSmallestVariant('wlpr_one', 50000, 50000)).toMatchObject({
          storageKey: 'small',
        });
        expect(yield* catalog.findSmallestVariant('wlpr_one', 60000, 50000)).toMatchObject({
          storageKey: 'large',
        });
        expect(yield* catalog.findSmallestVariant('wlpr_one', 90000, 50000)).toBeNull();
        expect(yield* catalog.findSmallestVariant('other-wallpaper', 1, 1)).toBeNull();
      })
    );
  });
  it('reconciles a pre-migration wallpaper without changing its committed metadata', async () => {
    if (wallpaper.kind !== 'wallpaper') throw new Error('invalid fixture');
    await drizzle(pool)
      .insert(wallpapers)
      .values({ ...wallpaper.wallpaper, createdAt: new Date('2025-12-31T00:00:00.000Z') });
    const replay: ProjectionInput = {
      ...wallpaper,
      wallpaper: { ...wallpaper.wallpaper, width: 800, storageKey: 'must-not-replace' },
    };
    await runtime.runPromise(
      Effect.gen(function* () {
        const projection = yield* CatalogProjection;
        yield* projection.accept(replay);
        const catalog = yield* Catalog;
        expect(yield* catalog.findWallpaper('wlpr_one')).toMatchObject({
          width: 1920,
          storageKey: 'original',
        });
        const outbox = yield* CatalogOutbox;
        const pending = yield* outbox.listPending(10);
        expect(pending).toHaveLength(1);
        expect(pending[0]?.variant).toMatchObject({
          width: 1920,
          createdAt: '2025-12-31T00:00:00.000Z',
        });
        for (const item of pending) yield* outbox.markPublished(item.id);
        yield* projection.accept({
          ...replay,
          occurrence: { source: 'ingestor', id: 'same-legacy-target-new-occurrence' },
        });
        expect(yield* outbox.listPending(10)).toEqual([]);
      })
    );
  });

  it('reuses pre-migration variant identity and metadata under concurrent occurrence replay', async () => {
    if (wallpaper.kind !== 'wallpaper') throw new Error('invalid fixture');
    const fixture = drizzle(pool);
    await fixture
      .insert(wallpapers)
      .values({ ...wallpaper.wallpaper, createdAt: new Date(wallpaper.wallpaper.createdAt) });
    await fixture
      .insert(variants)
      .values({
        id: 'var_zzlegacy',
        wallpaperId: 'wlpr_one',
        storageKey: 'legacy-small',
        width: 640,
        height: 360,
        fileSizeBytes: 100,
        createdAt: new Date('2025-12-31T00:00:00.000Z'),
      });
    const input: ProjectionInput = {
      kind: 'variant',
      occurrence: { source: 'generator', id: 'legacy-variant-replay' },
      occurredAt: '2026-01-01T00:00:01.000Z',
      variant: {
        wallpaperId: 'wlpr_one',
        storageBucket: 'wallpapers',
        storageKey: 'legacy-small',
        mimeType: 'image/webp',
        width: 320,
        height: 180,
        fileSizeBytes: 50,
        createdAt: '2026-01-01T00:00:01.000Z',
      },
    };
    await runtime.runPromise(
      Effect.gen(function* () {
        const projection = yield* CatalogProjection;
        yield* Effect.all(
          [
            projection.accept(input),
            projection.accept({
              ...input,
              occurrence: { source: 'generator', id: 'legacy-distinct-replay' },
            }),
          ],
          { concurrency: 2 }
        );
        const catalog = yield* Catalog;
        expect(yield* catalog.findSmallestVariant('wlpr_one', 1, 1)).toMatchObject({
          id: 'var_zzlegacy',
          storageBucket: 'wallpapers',
          width: 640,
        });
        const outbox = yield* CatalogOutbox;
        const pending = yield* outbox.listPending(10);
        expect(pending).toHaveLength(1);
        expect(pending[0]?.variant).toMatchObject({
          width: 640,
          fileSizeBytes: 100,
          format: 'image/jpeg',
          createdAt: '2025-12-31T00:00:00.000Z',
        });
        for (const item of pending) yield* outbox.markPublished(item.id);
        yield* projection.accept({
          ...input,
          occurrence: { source: 'generator', id: 'legacy-third-replay' },
        });
        expect(yield* outbox.listPending(10)).toEqual([]);
      })
    );
  });
});
