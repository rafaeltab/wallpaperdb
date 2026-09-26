import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { ManagedRuntime } from 'effect';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CatalogPostgresLayer } from '../src/adapters/catalog/index.js';
import { CatalogHealth, CatalogOutbox, CatalogProjection } from '../src/catalog/index.js';
import { Catalog } from '../src/delivery/index.js';

const timestamp = '2026-09-24T10:00:00.000Z';
describe('Catalog logical asset locations', () => {
  let postgres: Awaited<ReturnType<PostgreSqlContainer['start']>>;
  let pool: Pool;
  let runtime: ManagedRuntime.ManagedRuntime<
    Catalog | CatalogProjection | CatalogOutbox | CatalogHealth,
    unknown
  >;
  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
    pool = new Pool({ connectionString: postgres.getConnectionUri() });
    await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
    runtime = ManagedRuntime.make(
      CatalogPostgresLayer({
        databaseUrl: postgres.getConnectionUri(),
        assetBuckets: { wallpapers: 'private-originals', profilePictures: 'private-pictures' },
      })
    );
  });
  beforeEach(async () => {
    await pool.query(
      'TRUNCATE catalog_targets, catalog_processed, catalog_outbox, variants, wallpapers, profile_picture_assets, profile_picture_heads'
    );
  });
  afterAll(async () => {
    await runtime?.dispose();
    await pool?.end();
    await postgres?.stop();
  });

  it('accepts logical originals and reports catalog health without object-storage access', async () => {
    await runtime.runPromise(
      CatalogProjection.use((catalog) =>
        catalog.accept({
          kind: 'wallpaper',
          occurrence: { source: 'https://wallpaperdb/ingestor', id: 'logical-upload' },
          occurredAt: timestamp,
          wallpaper: {
            id: 'wlpr_logical_original',
            reference: { owner: 'ingestor', id: 'wlpr_logical_original' },
            mimeType: 'image/webp',
            width: 1600,
            height: 900,
            fileSizeBytes: 1234,
            createdAt: timestamp,
          },
        })
      )
    );
    expect(
      await runtime.runPromise(
        Catalog.use((catalog) => catalog.findWallpaper('wlpr_logical_original'))
      )
    ).toMatchObject({
      storageBucket: 'private-originals',
      storageKey: 'wlpr_logical_original/original.webp',
    });
    expect(
      await runtime.runPromise(CatalogOutbox.use((outbox) => outbox.listPending(10)))
    ).toHaveLength(1);
    expect(await runtime.runPromise(CatalogHealth.use((health) => health.check))).toBe(true);
  });

  it('rejects mismatched original identity before accepting its occurrence', async () => {
    const wallpaper = {
      id: 'wlpr_identity',
      reference: { owner: 'ingestor' as const, id: 'wlpr_another' },
      mimeType: 'image/png',
      width: 20,
      height: 10,
      fileSizeBytes: 50,
      createdAt: timestamp,
    };
    const event = {
      kind: 'wallpaper' as const,
      occurrence: { source: 'ingestor', id: 'identity' },
      occurredAt: timestamp,
      wallpaper,
    };
    await expect(
      runtime.runPromise(CatalogProjection.use((catalog) => catalog.accept(event)))
    ).rejects.toMatchObject({ _tag: 'CatalogFailure' });
    expect(
      await runtime.runPromise(Catalog.use((catalog) => catalog.findWallpaper(wallpaper.id)))
    ).toBeNull();
    expect(await runtime.runPromise(CatalogOutbox.use((outbox) => outbox.listPending(10)))).toEqual(
      []
    );
    await runtime.runPromise(
      CatalogProjection.use((catalog) =>
        catalog.accept({
          ...event,
          wallpaper: { ...wallpaper, reference: { ...wallpaper.reference, id: wallpaper.id } },
        })
      )
    );
    expect(
      await runtime.runPromise(Catalog.use((catalog) => catalog.findWallpaper(wallpaper.id)))
    ).toMatchObject({
      storageBucket: 'private-originals',
      storageKey: 'wlpr_identity/original.png',
    });
  });

  it('maps nominal rendition targets and Profile pictures to their configured buckets', async () => {
    const metadata = {
      mimeType: 'image/webp',
      width: 853,
      height: 480,
      fileSizeBytes: 100,
      createdAt: timestamp,
    };
    await runtime.runPromise(
      CatalogProjection.use((catalog) =>
        catalog.accept({
          kind: 'wallpaper',
          occurrence: { source: 'ingestor', id: 'parent' },
          occurredAt: timestamp,
          wallpaper: {
            ...metadata,
            id: 'wlpr_parent',
            reference: { owner: 'ingestor', id: 'wlpr_parent' },
          },
        })
      )
    );
    await runtime.runPromise(
      CatalogProjection.use((catalog) =>
        catalog.accept({
          kind: 'variant',
          occurrence: { source: 'variant-generator', id: 'variant' },
          occurredAt: timestamp,
          variant: {
            ...metadata,
            wallpaperId: 'wlpr_parent',
            reference: { owner: 'variant-generator', id: 'wlpr_parent:854x480:image/webp' },
          },
        })
      )
    );
    await runtime.runPromise(
      CatalogProjection.use((catalog) =>
        catalog.accept({
          kind: 'profile',
          occurrence: { source: 'user', id: 'picture' },
          occurredAt: timestamp,
          profile: {
            id: 'profile_owner',
            version: 1,
            pictureId: 'pic_current',
            updatedAt: timestamp,
          },
          asset: {
            ...metadata,
            id: 'pic_current',
            reference: { owner: 'user', id: 'pic_current' },
          },
        })
      )
    );
    expect(
      await runtime.runPromise(
        Catalog.use((catalog) => catalog.findSmallestVariant('wlpr_parent', 1, 1))
      )
    ).toMatchObject({
      storageBucket: 'private-originals',
      storageKey: 'wlpr_parent/variant_854x480.webp',
      width: 853,
      height: 480,
    });
    expect(
      await runtime.runPromise(Catalog.use((catalog) => catalog.findCurrentPicture('pic_current')))
    ).toMatchObject({
      storageBucket: 'private-pictures',
      storageKey: 'profile_owner/pic_current.webp',
    });
  });

  it('preserves retained coordinates instead of applying the current storage layout', async () => {
    const event = {
      kind: 'wallpaper' as const,
      occurrence: { source: 'legacy', id: 'legacy-original' },
      occurredAt: timestamp,
      wallpaper: {
        id: 'wlpr_legacy',
        storageBucket: 'historical-bucket',
        storageKey: 'custom/old-image.webp',
        mimeType: 'image/webp',
        width: 20,
        height: 10,
        fileSizeBytes: 40,
        createdAt: timestamp,
      },
    };
    await runtime.runPromise(CatalogProjection.use((catalog) => catalog.accept(event)));
    await runtime.runPromise(CatalogProjection.use((catalog) => catalog.accept(event)));
    expect(
      await runtime.runPromise(Catalog.use((catalog) => catalog.findWallpaper('wlpr_legacy')))
    ).toMatchObject({ storageBucket: 'historical-bucket', storageKey: 'custom/old-image.webp' });
    expect(
      await runtime.runPromise(CatalogOutbox.use((outbox) => outbox.listPending(10)))
    ).toHaveLength(1);
  });
});
