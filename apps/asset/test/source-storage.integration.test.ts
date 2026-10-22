import { createHash } from 'node:crypto';
import { createDefaultTesterBuilder, DockerTesterBuilder, S3TesterBuilder } from '@wallpaperdb/test-utils';
import { Effect, ManagedRuntime } from 'effect';
import sharp from 'sharp';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { sourceStorageLayer } from '../src/adapters/sources/index.js';
import { SourceBytes, MandatoryInspection } from '../src/capabilities/sources/index.js';
import { initialSourcePolicies } from '../src/capabilities/sources/policy.js';
const Tester = createDefaultTesterBuilder().with(DockerTesterBuilder).with(S3TesterBuilder).build();
const tester = new Tester().withS3().withS3Bucket('source-private');
beforeAll(() => tester.setup(), 60000);
afterAll(() => tester.destroy());
it('conditionally stores one exact identity, verifies mandatory actual facts and prepares immutable original bytes', async () => {
  const s3 = tester.getS3();
  const runtime = ManagedRuntime.make(sourceStorageLayer({ endpoint: s3.endpoints.fromHost, region: 'us-east-1', accessKeyId: s3.options.accessKey, secretAccessKey: s3.options.secretKey, bucket: 'source-private' }));
  const bytes = await sharp({ create: { width: 3, height: 2, channels: 3, background: 'red' } }).png().toBuffer();
  const digest = createHash('sha256').update(bytes).digest('hex');
  try {
    await runtime.runPromise(Effect.gen(function* () {
      const storage = yield* SourceBytes;
      const inspector = yield* MandatoryInspection;
      yield* storage.put('candidate_1', bytes, digest);
      yield* storage.put('candidate_1', bytes, digest);
      expect(yield* Effect.exit(storage.put('candidate_1', new Uint8Array([9,8,7]), 'b'.repeat(64)))).toMatchObject({ _tag: 'Failure' });
      const inspected = yield* inspector.inspect('candidate_1', initialSourcePolicies.wallpaper);
      expect(inspected).toMatchObject({ kind: 'verified', facts: { width: 3, height: 2, model: 'sdr-png', mimeType: 'image/png', digest, byteLength: bytes.length } });
      if (inspected.kind !== 'verified') throw new Error('Expected verified image');
      yield* storage.prepare('candidate_1', 'source_1', 'asset_1', inspected.facts);
      yield* storage.prepare('candidate_1', 'source_1', 'asset_1', inspected.facts);
      const original = yield* storage.read('source_1', 'asset_1');
      const chunks: Uint8Array[] = [];
      yield* Effect.promise(async () => { for await (const chunk of original.bytes) chunks.push(chunk); });
      yield* original.close();
      expect(Buffer.concat(chunks)).toEqual(bytes);
      expect(yield* Effect.exit(storage.read('source_other', 'asset_1'))).toMatchObject({ _tag: 'Failure' });
    }));
  } finally { await runtime.dispose(); }
});
