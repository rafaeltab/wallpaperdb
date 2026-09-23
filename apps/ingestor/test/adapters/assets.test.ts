import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { Effect, ManagedRuntime } from 'effect';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AssetsHealth, assetsLayer } from '../../src/adapters/assets/index.js';
import { AssetStorage } from '../../src/ingestion/index.js';

describe('owned wallpaper assets', () => {
  let container: StartedTestContainer;
  let runtime: ManagedRuntime.ManagedRuntime<AssetStorage | AssetsHealth, unknown>;
  beforeAll(async () => {
    container = await new GenericContainer('chrislusf/seaweedfs:4.47')
      .withEnvironment({ AWS_ACCESS_KEY_ID: 'storageadmin', AWS_SECRET_ACCESS_KEY: 'storageadmin' })
      .withCommand(['mini', '-dir=/data', '-ip=127.0.0.1', '-ip.bind=0.0.0.0', '-s3.port=9000',
        '-s3.autoCreateBucket=false', '-s3.port.iceberg=0', '-s3.port.lance=0', '-admin.ui=false',
        '-webdav=false', '-master.telemetry=false'])
      .withExposedPorts(9000)
      .withWaitStrategy(Wait.forAll([
        Wait.forLogMessage('All enabled components are running and ready to use:'),
        Wait.forHttp('/healthz', 9000),
      ])).start();
    const config = {
      endpoint: `http://${container.getHost()}:${container.getMappedPort(9000)}`,
      region: 'us-east-1', accessKeyId: 'storageadmin', secretAccessKey: 'storageadmin',
      bucket: 'ingestor-assets',
    };
    const client = new S3Client({ endpoint: config.endpoint, region: config.region,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      forcePathStyle: true });
    try { await client.send(new CreateBucketCommand({ Bucket: config.bucket })); }
    finally { client.destroy(); }
    runtime = ManagedRuntime.make(assetsLayer(config));
  });
  afterAll(async () => {
    await runtime?.dispose();
    await container?.stop();
  });
  it('stores, finds, lists, and idempotently removes an owned asset', async () => {
    await runtime.runPromise(Effect.gen(function* () {
      const assets = yield* AssetStorage;
      const reference = { wallpaperId: 'wlpr_assets', extension: 'png' };
      expect(yield* assets.exists(reference)).toBe(false);
      yield* assets.put({ wallpaperId: reference.wallpaperId, profileId: 'user_assets',
        bytes: new Uint8Array([1, 2, 3]), metadata: {
          mimeType: 'image/png', fileType: 'image', width: 12, height: 8, fileSizeBytes: 3,
          contentHash: 'hash', extension: reference.extension,
        } });
      expect(yield* assets.exists(reference)).toBe(true);
      expect((yield* assets.list()).assets).toContainEqual(reference);
      yield* assets.remove(reference);
      yield* assets.remove(reference);
      expect(yield* assets.exists(reference)).toBe(false);
    }));
  });
  it('distinguishes unavailable storage from an absent object', async () => {
    expect(await runtime.runPromise(AssetsHealth.use((health) => health.check()))).toBe(true);
    await container.stop();
    expect(await runtime.runPromise(AssetsHealth.use((health) => health.check()))).toBe(false);
    expect(await runtime.runPromise(AssetStorage.use((assets) =>
      assets.exists({ wallpaperId: 'wlpr_outage', extension: 'png' }).pipe(Effect.flip)
    ))).toMatchObject({ _tag: 'IngestionUnavailable', operation: 'inspect-asset' });
  });
});
