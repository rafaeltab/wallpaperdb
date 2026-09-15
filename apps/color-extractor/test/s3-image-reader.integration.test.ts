import 'reflect-metadata';
import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  S3TesterBuilder,
} from '@wallpaperdb/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { S3Connection } from '../src/connections/s3.js';
import { S3ImageReader } from '../src/services/s3-image-reader.js';

const TesterClass = createDefaultTesterBuilder()
  .with(DockerTesterBuilder)
  .with(S3TesterBuilder)
  .build();

describe('S3ImageReader integration', () => {
  let tester: InstanceType<typeof TesterClass>;

  beforeAll(async () => {
    tester = new TesterClass();
    tester.withS3().withS3Bucket('wallpapers');
    await tester.setup();
  });

  afterAll(async () => {
    await tester.destroy();
  });

  it('downloads the complete object as a buffer', async () => {
    const expected = Buffer.from('streamed image bytes');
    await tester.s3.uploadObject('wallpapers', 'test/image.bin', expected);
    const connection = {
      getClient: () => tester.s3.getS3Client(),
    } as unknown as S3Connection;

    const result = await new S3ImageReader(connection).read('wallpapers', 'test/image.bin');

    expect(result).toEqual(expected);
  });
});
