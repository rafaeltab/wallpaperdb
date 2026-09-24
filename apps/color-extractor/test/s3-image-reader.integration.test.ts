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

const TesterClass = createDefaultTesterBuilder()
  .with(DockerTesterBuilder)
  .with(S3TesterBuilder)
  .build();

describe('Stored image histogram adapter', () => {
  let tester: InstanceType<typeof TesterClass>;
  let runtime: ManagedRuntime.ManagedRuntime<ImageHistogram | ImageHealth, never>;

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
