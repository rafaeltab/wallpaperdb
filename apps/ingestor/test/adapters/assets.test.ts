import {
  CreateBucketCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Effect, ManagedRuntime } from 'effect';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AssetsHealth, assetsLayer } from '../../src/adapters/assets/index.js';
import { AssetStorage } from '../../src/ingestion/index.js';

describe('owned wallpaper assets', () => {
  let container: StartedTestContainer;
  let runtime: ManagedRuntime.ManagedRuntime<AssetStorage | AssetsHealth, unknown>;
  let client: S3Client;
  beforeAll(async () => {
    container = await new GenericContainer('chrislusf/seaweedfs:4.47')
      .withEnvironment({ AWS_ACCESS_KEY_ID: 'storageadmin', AWS_SECRET_ACCESS_KEY: 'storageadmin' })
      .withCommand([
        'mini',
        '-dir=/data',
        '-ip=127.0.0.1',
        '-ip.bind=0.0.0.0',
        '-s3.port=9000',
        '-s3.autoCreateBucket=false',
        '-s3.port.iceberg=0',
        '-s3.port.lance=0',
        '-admin.ui=false',
        '-webdav=false',
        '-master.telemetry=false',
      ])
      .withExposedPorts(9000)
      .withWaitStrategy(
        Wait.forAll([
          Wait.forLogMessage('All enabled components are running and ready to use:'),
          Wait.forHttp('/healthz', 9000),
        ])
      )
      .start();
    const config = {
      endpoint: `http://${container.getHost()}:${container.getMappedPort(9000)}`,
      region: 'us-east-1',
      accessKeyId: 'storageadmin',
      secretAccessKey: 'storageadmin',
      bucket: 'ingestor-assets',
    };
    client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      forcePathStyle: true,
    });
    await client.send(new CreateBucketCommand({ Bucket: config.bucket }));
    runtime = ManagedRuntime.make(assetsLayer(config));
  });
  afterAll(async () => {
    await runtime?.dispose();
    client?.destroy();
    await container?.stop();
  });
  it('preserves original bytes and content type through the owned asset lifecycle', async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const assets = yield* AssetStorage;
        const reference = { wallpaperId: 'wlpr_assets', extension: 'png' };
        expect(yield* assets.exists(reference)).toBe(false);
        yield* assets.put({
          wallpaperId: reference.wallpaperId,
          profileId: 'user_assets',
          bytes: new Uint8Array([1, 2, 3]),
          metadata: {
            mimeType: 'image/png',
            fileType: 'image',
            width: 12,
            height: 8,
            fileSizeBytes: 3,
            contentHash: 'hash',
            extension: reference.extension,
          },
        });
        const stored = yield* Effect.promise(() =>
          client.send(
            new GetObjectCommand({
              Bucket: 'ingestor-assets',
              Key: 'wlpr_assets/original.png',
            })
          )
        );
        const storedBytes = yield* Effect.promise(async () => stored.Body?.transformToByteArray());
        expect(storedBytes).toEqual(new Uint8Array([1, 2, 3]));
        expect(stored.ContentType).toBe('image/png');
        expect(yield* assets.exists(reference)).toBe(true);
        expect((yield* assets.list()).assets).toContainEqual(reference);
        yield* assets.remove(reference);
        yield* assets.remove(reference);
        expect(yield* assets.exists(reference)).toBe(false);
      })
    );
  });
  it('paginates bounded cleanup batches and excludes foreign object layouts', async () => {
    const names = Array.from({ length: 101 }, (_, index) => `wlpr_page_${index}`);
    const keys = [
      ...names.map((name) => `${name}/original.png`),
      'profile-picture/image.png',
      'wlpr_other/variant.png',
    ];
    await Effect.runPromise(
      Effect.forEach(
        keys,
        (Key) =>
          Effect.promise(() =>
            client.send(
              new PutObjectCommand({ Bucket: 'ingestor-assets', Key, Body: new Uint8Array([1]) })
            )
          ),
        { concurrency: 8 }
      )
    );
    const found: string[] = [];
    await runtime.runPromise(
      Effect.gen(function* () {
        const assets = yield* AssetStorage;
        let cursor: string | undefined;
        do {
          const page = yield* assets.list(cursor);
          expect(page.assets.length).toBeLessThanOrEqual(100);
          found.push(...page.assets.map((asset) => asset.wallpaperId));
          cursor = page.cursor;
        } while (cursor);
      })
    );
    expect(found.sort()).toEqual(names.sort());
  });
  it('distinguishes unavailable storage from an absent object', async () => {
    expect(await runtime.runPromise(AssetsHealth.use((health) => health.check()))).toBe(true);
    await container.stop();
    expect(await runtime.runPromise(AssetsHealth.use((health) => health.check()))).toBe(false);
    expect(
      await runtime.runPromise(
        AssetStorage.use((assets) =>
          assets.exists({ wallpaperId: 'wlpr_outage', extension: 'png' }).pipe(Effect.flip)
        )
      )
    ).toMatchObject({ _tag: 'IngestionUnavailable', operation: 'inspect-asset' });
  });
});
