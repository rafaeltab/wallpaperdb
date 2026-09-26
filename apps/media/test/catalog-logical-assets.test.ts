import { CreateBucketCommand } from '@aws-sdk/client-s3';
import { registerAssetReference } from '@wallpaperdb/core/assets';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  S3TesterBuilder,
} from '@wallpaperdb/test-utils';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { ManagedRuntime } from 'effect';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CatalogPostgresLayer } from '../src/adapters/catalog/index.js';
import {
  CatalogHealth,
  CatalogOutbox,
  CatalogProjection,
  type ProjectionInput,
} from '../src/catalog/index.js';
import { Catalog } from '../src/delivery/index.js';

const timestamp = '2026-09-24T10:00:00.000Z';
const Tester = createDefaultTesterBuilder().with(DockerTesterBuilder).with(S3TesterBuilder).build();
const storage = new Tester().withS3().withS3Bucket('asset-references');

describe('Catalog immutable asset reference contract', () => {
  let postgres: Awaited<ReturnType<PostgreSqlContainer['start']>>;
  let pool: Pool;
  let runtime: ManagedRuntime.ManagedRuntime<Catalog | CatalogProjection | CatalogOutbox, unknown>;
  beforeAll(async () => {
    [postgres] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      storage.setup(),
    ]);
    pool = new Pool({ connectionString: postgres.getConnectionUri() });
    await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
    const s3 = storage.getS3();
    runtime = ManagedRuntime.make(
      CatalogPostgresLayer({
        databaseUrl: postgres.getConnectionUri(),
        assetReferences: {
          endpoint: s3.endpoints.fromHost,
          region: 'us-east-1',
          accessKeyId: s3.options.accessKey,
          secretAccessKey: s3.options.secretKey,
          bucket: 'asset-references',
        },
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
    await storage.destroy();
  });

  it('reports missing asset reference storage and recovers when restored', async () => {
    const s3 = storage.getS3();
    const referenceBucket = 'recovered-health-references';
    const isolated = ManagedRuntime.make(
      CatalogPostgresLayer({
        databaseUrl: postgres.getConnectionUri(),
        assetReferences: {
          endpoint: s3.endpoints.fromHost,
          region: 'us-east-1',
          accessKeyId: s3.options.accessKey,
          secretAccessKey: s3.options.secretKey,
          bucket: referenceBucket,
        },
      })
    );
    try {
      expect(await isolated.runPromise(CatalogHealth.use((health) => health.check))).toBe(false);
      await storage.s3.getS3Client().send(new CreateBucketCommand({ Bucket: referenceBucket }));
      expect(await isolated.runPromise(CatalogHealth.use((health) => health.check))).toBe(true);
    } finally {
      await isolated.dispose();
    }
  });

  it('resolves an immutable original reference before persisting its delivery location', async () => {
    const reference = { owner: 'ingestor', id: 'logical-original' } as const;
    await registerAssetReference(storage.s3.getS3Client(), 'asset-references', reference, {
      bucket: 'private-originals',
      key: 'actual/original.webp',
    });
    await runtime.runPromise(
      CatalogProjection.use((catalog) =>
        catalog.accept({
          kind: 'wallpaper',
          occurrence: { source: 'https://wallpaperdb/ingestor', id: 'logical-upload' },
          occurredAt: timestamp,
          wallpaper: {
            id: 'logical-original',
            reference,
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
      await runtime.runPromise(Catalog.use((catalog) => catalog.findWallpaper('logical-original')))
    ).toMatchObject({ storageBucket: 'private-originals', storageKey: 'actual/original.webp' });
    expect(
      await runtime.runPromise(CatalogOutbox.use((outbox) => outbox.listPending(10)))
    ).toHaveLength(1);
  });

  it('leaves an unavailable reference unprocessed so its original occurrence can be replayed', async () => {
    const reference = { owner: 'ingestor', id: 'delayed-original' } as const;
    const input: ProjectionInput = {
      kind: 'wallpaper',
      occurrence: { source: 'https://wallpaperdb/ingestor', id: 'delayed-upload' },
      occurredAt: timestamp,
      wallpaper: {
        id: reference.id,
        reference,
        mimeType: 'image/webp',
        width: 20,
        height: 10,
        fileSizeBytes: 100,
        createdAt: timestamp,
      },
    };
    await expect(
      runtime.runPromise(CatalogProjection.use((catalog) => catalog.accept(input)))
    ).rejects.toMatchObject({ _tag: 'CatalogFailure' });
    expect(
      await runtime.runPromise(Catalog.use((catalog) => catalog.findWallpaper(reference.id)))
    ).toBeNull();
    expect(await runtime.runPromise(CatalogOutbox.use((outbox) => outbox.listPending(10)))).toEqual(
      []
    );
    await registerAssetReference(storage.s3.getS3Client(), 'asset-references', reference, {
      bucket: 'originals',
      key: 'delayed.webp',
    });
    await runtime.runPromise(CatalogProjection.use((catalog) => catalog.accept(input)));
    expect(
      await runtime.runPromise(Catalog.use((catalog) => catalog.findWallpaper(reference.id)))
    ).toMatchObject({ storageBucket: 'originals', storageKey: 'delayed.webp' });
    expect(
      await runtime.runPromise(CatalogOutbox.use((outbox) => outbox.listPending(10)))
    ).toHaveLength(1);
  });

  it('resolves generated renditions and profile pictures through their owning producers', async () => {
    const rendition = { owner: 'variant-generator', id: 'logical-rendition' } as const;
    const picture = { owner: 'user', id: 'logical-picture' } as const;
    for (const reference of [rendition, picture]) {
      await registerAssetReference(storage.s3.getS3Client(), 'asset-references', reference, {
        bucket: reference.owner,
        key: `${reference.id}.webp`,
      });
    }
    await runtime.runPromise(
      CatalogProjection.use((catalog) =>
        catalog.accept({
          kind: 'wallpaper',
          occurrence: { source: 'ingestor', id: 'parent' },
          occurredAt: timestamp,
          wallpaper: {
            id: 'parent',
            storageBucket: 'originals',
            storageKey: 'parent.webp',
            mimeType: 'image/webp',
            width: 20,
            height: 10,
            fileSizeBytes: 100,
            createdAt: timestamp,
          },
        })
      )
    );
    await runtime.runPromise(
      CatalogProjection.use((catalog) =>
        catalog.accept({
          kind: 'variant',
          occurrence: { source: 'variant-generator', id: 'rendition' },
          occurredAt: timestamp,
          variant: {
            wallpaperId: 'parent',
            reference: rendition,
            mimeType: 'image/webp',
            width: 10,
            height: 5,
            fileSizeBytes: 50,
            createdAt: timestamp,
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
          profile: { id: 'profile', version: 1, pictureId: picture.id, updatedAt: timestamp },
          asset: {
            id: picture.id,
            reference: picture,
            mimeType: 'image/webp',
            width: 256,
            height: 256,
            fileSizeBytes: 300,
            createdAt: timestamp,
          },
        })
      )
    );
    expect(
      await runtime.runPromise(
        Catalog.use((catalog) => catalog.findSmallestVariant('parent', 1, 1))
      )
    ).toMatchObject({ storageBucket: 'variant-generator', storageKey: `${rendition.id}.webp` });
    expect(
      await runtime.runPromise(Catalog.use((catalog) => catalog.findCurrentPicture(picture.id)))
    ).toMatchObject({ storageBucket: 'user', storageKey: `${picture.id}.webp` });
  });
});
