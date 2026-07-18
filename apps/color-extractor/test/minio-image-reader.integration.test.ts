import 'reflect-metadata';
import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  MinioTesterBuilder,
} from '@wallpaperdb/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MinioConnection } from '../src/connections/minio.js';
import { MinioImageReader } from '../src/services/minio-image-reader.js';

const TesterClass = createDefaultTesterBuilder()
  .with(DockerTesterBuilder)
  .with(MinioTesterBuilder)
  .build();

describe('MinioImageReader integration', () => {
  let tester: InstanceType<typeof TesterClass>;

  beforeAll(async () => {
    tester = new TesterClass();
    tester.withMinio().withMinioBucket('wallpapers');
    await tester.setup();
  });

  afterAll(async () => {
    await tester.destroy();
  });

  it('downloads the complete object as a buffer', async () => {
    const expected = Buffer.from('streamed image bytes');
    await tester.minio.uploadObject('wallpapers', 'test/image.bin', expected);
    const connection = {
      getClient: () => tester.minio.getS3Client(),
    } as unknown as MinioConnection;

    const result = await new MinioImageReader(connection).read('wallpapers', 'test/image.bin');

    expect(result).toEqual(expected);
  });
});
