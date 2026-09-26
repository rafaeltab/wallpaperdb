import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { createDefaultTesterBuilder, DockerTesterBuilder, S3TesterBuilder } from '@wallpaperdb/test-utils';
import { Effect, ManagedRuntime } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pictureStorageLayer } from '../src/adapters/pictures/index.js';
import { PictureObjects, type StoredPicture } from '../src/pictures/index.js';

describe('Private immutable picture storage', () => {
  const Tester = createDefaultTesterBuilder().with(DockerTesterBuilder).with(S3TesterBuilder).build();
  const tester = new Tester().withS3().withS3Bucket('picture-adapter');
  let runtime: ManagedRuntime.ManagedRuntime<PictureObjects, never>;
  let client: S3Client;
  const asset: StoredPicture = {
    id: 'pic_storage', profileId: 'owner', storageBucket: 'picture-adapter', storageKey: 'owner/pic_storage.webp',
    mimeType: 'image/webp', width: 2, height: 3, fileSizeBytes: 5, expiresAt: null,
  };
  beforeAll(async () => {
    await tester.setup();
    const config = tester.s3.config;
    client = tester.s3.getS3Client();
    runtime = ManagedRuntime.make(pictureStorageLayer({ endpoint: config.endpoints.fromHost,
      region: 'us-east-1', accessKeyId: config.options.accessKey, secretAccessKey: config.options.secretKey,
    }));
  });
  afterAll(async () => { await runtime?.dispose(); client?.destroy(); await tester.destroy(); });
  it('preserves first stored bytes, keeps objects private, and retries deletion safely', async () => {
    await runtime.runPromise(Effect.flatMap(PictureObjects, objects => objects.put(asset, Buffer.from('first'))));
    await expect(runtime.runPromise(Effect.flatMap(PictureObjects, objects => objects.put(asset, Buffer.from('other'))))).rejects.toMatchObject({ _tag: 'PictureUnavailable' });
    const object = await client.send(new GetObjectCommand({ Bucket: asset.storageBucket, Key: asset.storageKey }));
    expect(await object.Body?.transformToString()).toBe('first');
    expect(object.ContentType).toBe('image/webp');
    expect((await fetch(`${tester.s3.config.endpoints.fromHost}/${asset.storageBucket}/${asset.storageKey}`)).status).toBe(403);
    for (let attempt = 0; attempt < 2; attempt++) {
      await runtime.runPromise(Effect.flatMap(PictureObjects, objects => objects.delete(asset)));
    }
    await expect(client.send(new GetObjectCommand({ Bucket: asset.storageBucket, Key: asset.storageKey }))).rejects.toMatchObject({ name: 'NoSuchKey' });
  });
});
