import { createHash } from 'node:crypto';
import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  S3TesterBuilder,
} from '@wallpaperdb/test-utils';
import { Effect, ManagedRuntime } from 'effect';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sourceStorageLayer } from '../src/adapters/sources/index.js';
import { SourceBytes } from '../src/capabilities/sources/index.js';
import { CleanupBytes } from '../src/capabilities/cleanup/index.js';

const Tester = createDefaultTesterBuilder().with(DockerTesterBuilder).with(S3TesterBuilder).build();
const tester = new Tester().withS3().withS3Bucket('cleanup-private');
beforeAll(() => tester.setup(), 60000);
afterAll(() => tester.destroy());

it('reclaims exact bytes replayably and fences a late conditional write without touching a newer identity', async () => {
  const s3 = tester.getS3();
  const runtime = ManagedRuntime.make(
    sourceStorageLayer({
      endpoint: s3.endpoints.fromHost,
      region: 'us-east-1',
      accessKeyId: s3.options.accessKey,
      secretAccessKey: s3.options.secretKey,
      bucket: 'cleanup-private',
    })
  );
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const digest = createHash('sha256').update(bytes).digest('hex');
  try {
    await runtime.runPromise(
      Effect.gen(function* () {
        const storage = yield* SourceBytes;
        const cleanup = yield* CleanupBytes;
        yield* storage.put('old', bytes, digest);
        yield* storage.put('new', bytes, digest);
        yield* cleanup.reclaim({ kind: 'candidate', candidateId: 'old' });
        yield* cleanup.reclaim({ kind: 'candidate', candidateId: 'old' });
        expect(yield* Effect.exit(storage.put('old', bytes, digest))).toMatchObject({
          _tag: 'Failure',
        });
        // An absent reserved identity must also fence a write that has not reached storage yet.
        yield* cleanup.reclaim({ kind: 'source', assetId: 'asset', sourceId: 'late' });
        expect(
          yield* Effect.exit(
            storage.prepare('new', 'late', 'asset', {
              model: 'sdr-png',
              mimeType: 'image/png',
              width: 2,
              height: 2,
              byteLength: 4,
              digest,
            })
          )
        ).toMatchObject({ _tag: 'Failure' });
        yield* storage.prepare('new', 'new', 'asset', {
          model: 'sdr-png',
          mimeType: 'image/png',
          width: 2,
          height: 2,
          byteLength: 4,
          digest,
        });
        const original = yield* storage.read('new', 'asset');
        const chunks: Uint8Array[] = [];
        yield* Effect.promise(async () => {
          for await (const chunk of original.bytes) chunks.push(chunk);
        });
        yield* original.close();
        expect(Buffer.concat(chunks)).toEqual(Buffer.from(bytes));
      })
    );
  } finally {
    await runtime.dispose();
  }
});
