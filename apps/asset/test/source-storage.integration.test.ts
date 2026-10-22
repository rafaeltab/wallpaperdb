import { createHash } from 'node:crypto';
import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  S3TesterBuilder,
} from '@wallpaperdb/test-utils';
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
  const runtime = ManagedRuntime.make(
    sourceStorageLayer({
      endpoint: s3.endpoints.fromHost,
      region: 'us-east-1',
      accessKeyId: s3.options.accessKey,
      secretAccessKey: s3.options.secretKey,
      bucket: 'source-private',
    })
  );
  const bytes = await sharp({ create: { width: 3, height: 2, channels: 3, background: 'red' } })
    .png()
    .toBuffer();
  const digest = createHash('sha256').update(bytes).digest('hex');
  try {
    await runtime.runPromise(
      Effect.gen(function* () {
        const storage = yield* SourceBytes;
        const inspector = yield* MandatoryInspection;
        yield* storage.put('candidate_1', bytes, digest);
        yield* storage.put('candidate_1', bytes, digest);
        expect(
          yield* Effect.exit(storage.put('candidate_1', new Uint8Array([9, 8, 7]), 'b'.repeat(64)))
        ).toMatchObject({ _tag: 'Failure' });
        const inspected = yield* inspector.inspect('candidate_1', initialSourcePolicies.wallpaper);
        expect(inspected).toMatchObject({
          kind: 'verified',
          facts: {
            width: 3,
            height: 2,
            model: 'sdr-png',
            mimeType: 'image/png',
            digest,
            byteLength: bytes.length,
          },
        });
        if (inspected.kind !== 'verified') throw new Error('Expected verified image');
        yield* storage.prepare('candidate_1', 'source_1', 'asset_1', inspected.facts);
        yield* storage.prepare('candidate_1', 'source_1', 'asset_1', inspected.facts);
        const original = yield* storage.read('source_1', 'asset_1');
        const chunks: Uint8Array[] = [];
        yield* Effect.promise(async () => {
          for await (const chunk of original.bytes) chunks.push(chunk);
        });
        yield* original.close();
        expect(Buffer.concat(chunks)).toEqual(bytes);
        expect(yield* Effect.exit(storage.read('source_other', 'asset_1'))).toMatchObject({
          _tag: 'Failure',
        });
      })
    );
  } finally {
    await runtime.dispose();
  }
});

it('preserves canonical animated SDR WebP timing and rejects HDR declarations that native metadata hides', async () => {
  const { readFile } = await import('node:fs/promises');
  const s3 = tester.getS3();
  const runtime = ManagedRuntime.make(
    sourceStorageLayer({
      endpoint: s3.endpoints.fromHost,
      region: 'us-east-1',
      accessKeyId: s3.options.accessKey,
      secretAccessKey: s3.options.secretKey,
      bucket: 'source-private',
    })
  );
  const gif = Buffer.from(
    '47494638396101000100800000000000ffffff21ff0b4e45545343415045322e30030102000021f904010a0000002c000000000100010000020244010021f90401140000002c00000000010001000002024c01003b',
    'hex'
  );
  const animated = await sharp(gif, { animated: true })
    .resize(512, 512, { fit: 'fill' })
    .webp()
    .toBuffer();
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } })
    .png()
    .toBuffer();
  const chunk = Buffer.from([0, 0, 0, 4, 99, 73, 67, 80, 9, 16, 0, 1, 0, 0, 0, 0]);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, 12)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 12);
  const hdrPng = Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]);
  try {
    await runtime.runPromise(
      Effect.gen(function* () {
        const bytes = yield* SourceBytes;
        const inspector = yield* MandatoryInspection;
        yield* bytes.put(
          'candidate_animated',
          animated,
          createHash('sha256').update(animated).digest('hex')
        );
        expect(
          yield* inspector.inspect('candidate_animated', initialSourcePolicies.picture)
        ).toMatchObject({
          kind: 'verified',
          facts: {
            width: 512,
            height: 512,
            model: 'animated-sdr-webp',
            animation: { frames: 2, loop: 3, delaysMs: [100, 200] },
          },
        });
        expect(
          yield* inspector.inspect('candidate_animated', initialSourcePolicies.wallpaper)
        ).toMatchObject({ kind: 'rejected', reason: 'unsupported-source-model' });
        yield* bytes.put(
          'candidate_hdr_png',
          hdrPng,
          createHash('sha256').update(hdrPng).digest('hex')
        );
        expect(
          yield* inspector.inspect('candidate_hdr_png', initialSourcePolicies.wallpaper)
        ).toMatchObject({ kind: 'rejected', reason: 'unsupported-source-model' });
      })
    );
    for (const name of ['apple_gainmap_old.jpg', 'apple_gainmap_new.jpg']) {
      const fixture = await readFile(
        new URL(`../../user/test/fixtures/profile-picture-hdr/${name}`, import.meta.url)
      );
      await runtime.runPromise(
        SourceBytes.use((bytes) =>
          bytes.put(name, fixture, createHash('sha256').update(fixture).digest('hex'))
        )
      );
      expect(
        await runtime.runPromise(
          MandatoryInspection.use((inspector) =>
            inspector.inspect(name, initialSourcePolicies.wallpaper)
          )
        )
      ).toMatchObject({ kind: 'rejected', reason: 'unsupported-source-model' });
    }
  } finally {
    await runtime.dispose();
  }
});
