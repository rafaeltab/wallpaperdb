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
import { ImageMeasurements } from '../src/capabilities/extraction/index.js';

const TesterClass = createDefaultTesterBuilder()
  .with(DockerTesterBuilder)
  .with(S3TesterBuilder)
  .build();

describe('Stored image measurements adapter', () => {
  let tester: InstanceType<typeof TesterClass>;
  let runtime: ManagedRuntime.ManagedRuntime<ImageMeasurements | ImageHealth, never>;

  beforeAll(async () => {
    tester = new TesterClass();
    tester.withS3().withS3Bucket('wallpapers').withS3Bucket('other-wallpapers');
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
    const measured = await runtime.runPromise(
      Effect.gen(function* () {
        const images = yield* ImageMeasurements;
        return yield* images.extract({ bucket: 'other-wallpapers', key: 'test/red.png' });
      })
    );
    expect(measured.measurements.sampleCount).toBe(16384);
    expect(measured.measurements.named.red.coverage).toBe(10000);
  });

  it('reports a typed failure when the object is missing', async () => {
    const result = await runtime.runPromise(
      Effect.result(
        Effect.gen(function* () {
          const images = yield* ImageMeasurements;
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
  it('reads a logical original without a descriptor store', async () => {
    const red = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#ff0000' } })
      .png()
      .toBuffer();
    const reference = { owner: 'ingestor', id: 'logical-red', mimeType: 'image/png' } as const;
    await tester.s3.uploadObject('wallpapers', 'logical-red/original.png', red);
    const measured = await runtime.runPromise(
      Effect.flatMap(ImageMeasurements, (images) => images.extract(reference))
    );
    expect(measured.measurements.sampleCount).toBe(16384);
    expect(measured.measurements.named.red.coverage).toBe(10000);
  });

  it('reports missing image storage and recovers when restored', async () => {
    const s3 = tester.getS3();
    const imageBucket = 'recovered-health-images';
    const isolated = ManagedRuntime.make(
      imageLayer({
        endpoint: s3.endpoints.fromHost,
        region: 'us-east-1',
        accessKeyId: s3.options.accessKey,
        secretAccessKey: s3.options.secretKey,
        bucket: imageBucket,
      })
    );
    try {
      expect(await isolated.runPromise(ImageHealth.use((health) => health.check()))).toBe(false);
      await tester.s3.getS3Client().send(new CreateBucketCommand({ Bucket: imageBucket }));
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
