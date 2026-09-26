import { createDefaultTesterBuilder, DockerTesterBuilder, S3TesterBuilder } from '@wallpaperdb/test-utils';
import { Effect, ManagedRuntime } from 'effect';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { AssetReader } from '../src/delivery/index.js';
import { s3AssetsLayer } from '../src/adapters/assets/index.js';
const Tester = createDefaultTesterBuilder().with(DockerTesterBuilder).with(S3TesterBuilder).build();
const tester = new Tester().withS3().withS3Bucket('assets');
beforeAll(() => tester.setup(), 60000);
afterAll(() => tester.destroy());
it('reads exact stored bytes and distinguishes missing objects', async () => {
  await tester.s3.uploadObject('assets', 'image', Buffer.from([9,4,1]));
  const s3 = tester.getS3();
  const runtime = ManagedRuntime.make(s3AssetsLayer({ endpoint: s3.endpoints.fromHost, region: 'us-east-1', accessKeyId: s3.options.accessKey, secretAccessKey: s3.options.secretKey, bucket: 'assets' }));
  try {
    const body = await runtime.runPromise(Effect.flatMap(AssetReader, a => a.read({ storageBucket: 'assets', storageKey: 'image' })));
    if (!body) throw new Error('missing image');
    const chunks = []; for await (const chunk of body) chunks.push(...chunk);
    expect(chunks).toEqual([9,4,1]);
    expect(await runtime.runPromise(Effect.flatMap(AssetReader, a => a.read({ storageBucket: 'assets', storageKey: 'missing' })))).toBeNull();
  } finally { await runtime.dispose(); }
});
