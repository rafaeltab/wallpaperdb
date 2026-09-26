import { CreateBucketCommand } from '@aws-sdk/client-s3';
import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  S3TesterBuilder,
} from '@wallpaperdb/test-utils';
import { Effect, ManagedRuntime, Result } from 'effect';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ImageHealth, imageLayer } from '../src/adapters/image/index.js';
import { ImageHistogram } from '../src/extraction/index.js';
import { registerAssetReference } from '@wallpaperdb/core/assets';

const TesterClass = createDefaultTesterBuilder()
  .with(DockerTesterBuilder)
  .with(S3TesterBuilder)
  .build();

describe('Stored image histogram adapter', () => {
  let tester: InstanceType<typeof TesterClass>;
  let runtime: ManagedRuntime.ManagedRuntime<ImageHistogram | ImageHealth, never>;

  beforeAll(async () => {
    tester = new TesterClass();
    tester
      .withS3()
      .withS3Bucket('wallpapers')
      .withS3Bucket('other-wallpapers')
      .withS3Bucket('asset-references');
    await tester.setup();
    const s3 = tester.getS3();
    runtime = ManagedRuntime.make(
      imageLayer({
        endpoint: s3.endpoints.fromHost,
        region: 'us-east-1',
        accessKeyId: s3.options.accessKey,
        secretAccessKey: s3.options.secretKey,
        bucket: 'wallpapers',
      })
    );
  });

  afterAll(async () => {
    await runtime.dispose();
    await tester.destroy();
  });

  it('extracts actual stored bytes from the input bucket and key', async () => {
    const red = await sharp({
      create: {
        width: 3,
        height: 2,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .png()
      .toBuffer();
    await tester.s3.uploadObject('other-wallpapers', 'test/red.png', red);
    const histogram = await runtime.runPromise(
      Effect.gen(function* () {
        const images = yield* ImageHistogram;
        return yield* images.extract({ bucket: 'other-wallpapers', key: 'test/red.png' });
      })
    );
    expect(histogram).toHaveLength(64);
    expect(histogram[3]).toBeCloseTo(1, 5);
  });

  it('reports a typed failure when the object is missing', async () => {
    const result = await runtime.runPromise(
      Effect.result(
        Effect.gen(function* () {
          const images = yield* ImageHistogram;
          return yield* images.extract({ bucket: 'wallpapers', key: 'missing.png' });
        })
      )
    );
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe('ExtractionUnavailable');
      expect(result.failure.operation).toBe('read-image');
      expect(result.failure.cause).toBeInstanceOf(Error);
    }
  });
  it('resolves an immutable logical original before reading its image bytes', async () => {
    const red = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#ff0000' } })
      .png()
      .toBuffer();
    const reference = { owner: 'ingestor', id: 'logical-red' } as const;
    await tester.s3.uploadObject('other-wallpapers', 'logical/red.png', red);
    await registerAssetReference(tester.s3.getS3Client(), 'asset-references', reference, {
      bucket: 'other-wallpapers',
      key: 'logical/red.png',
    });
    const histogram = await runtime.runPromise(
      Effect.flatMap(ImageHistogram, (images) => images.extract(reference))
    );
    expect(histogram).toHaveLength(64);
    expect(histogram[3]).toBeCloseTo(1, 5);
  });

  it('reports missing asset reference storage and recovers when restored', async () => {
    const s3 = tester.getS3();
    const referenceBucket = 'recovered-health-references';
    const isolated = ManagedRuntime.make(
      imageLayer({
        endpoint: s3.endpoints.fromHost,
        region: 'us-east-1',
        accessKeyId: s3.options.accessKey,
        secretAccessKey: s3.options.secretKey,
        bucket: 'wallpapers',
        assetReferenceBucket: referenceBucket,
      })
    );
    try {
      expect(await isolated.runPromise(ImageHealth.use((health) => health.check()))).toBe(false);
      await tester.s3.getS3Client().send(new CreateBucketCommand({ Bucket: referenceBucket }));
      expect(await isolated.runPromise(ImageHealth.use((health) => health.check()))).toBe(true);
    } finally {
      await isolated.dispose();
    }
  });

  it('checks the configured bucket', async () => {
    const healthy = await runtime.runPromise(
      Effect.gen(function* () {
        const health = yield* ImageHealth;
        return yield* health.check();
      })
    );
    expect(healthy).toBe(true);
  });
});
