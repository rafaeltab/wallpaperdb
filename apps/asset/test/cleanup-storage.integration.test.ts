import { createHash } from 'node:crypto';
import { createServer, request } from 'node:http';
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
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

it.each([
  'upload',
  'prepare',
] as const)('fences a real delayed %s and reconciles a lost reclamation response across both candidate paths', async (phase) => {
  const s3 = tester.getS3();
  const upstream = new URL(s3.endpoints.fromHost);
  let entered!: () => void,
    release = () => {};
  const held = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let delayed = false,
    lost = false;
  const candidateId = `delayed-${phase}`,
    sourceId = `late-${phase}`;
  const proxy = createServer((incoming, outgoing) => {
    const forward = () => {
      const forwarded = request(
        {
          hostname: upstream.hostname,
          port: upstream.port,
          path: incoming.url,
          method: incoming.method,
          headers: incoming.headers,
        },
        (response) => {
          if (
            incoming.headers['x-amz-meta-reclaimed'] === 'true' &&
            response.statusCode === 200 &&
            !lost
          ) {
            lost = true;
            response.resume();
            response.once('end', () => outgoing.destroy());
          } else {
            outgoing.writeHead(response.statusCode ?? 502, response.headers);
            response.pipe(outgoing);
          }
        }
      );
      forwarded.on('error', () => outgoing.destroy());
      incoming.pipe(forwarded);
    };
    const suffix =
      phase === 'upload' ? `/candidates/${candidateId}/input` : `/sources/${sourceId}/original`;
    if (
      !delayed &&
      incoming.method === 'PUT' &&
      incoming.headers['if-none-match'] === '*' &&
      incoming.url?.split('?')[0]?.endsWith(suffix)
    ) {
      delayed = true;
      release = forward;
      entered();
    } else forward();
  });
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  const address = proxy.address();
  if (!address || typeof address === 'string') throw new Error('Missing proxy');
  const runtime = ManagedRuntime.make(
    sourceStorageLayer({
      endpoint: `http://127.0.0.1:${address.port}`,
      region: 'us-east-1',
      accessKeyId: s3.options.accessKey,
      secretAccessKey: s3.options.secretKey,
      bucket: 'cleanup-private',
    })
  );
  const bytes = new Uint8Array([8, 7, 6, 5]),
    digest = createHash('sha256').update(bytes).digest('hex');
  const facts = {
    digest,
    byteLength: 4,
    model: 'sdr-png',
    mimeType: 'image/png',
    width: 2,
    height: 2,
  };
  let pending: Promise<unknown> | undefined;
  try {
    const canonicalKey = `asset-layout-1/private/candidates/${candidateId}/canonical`;
    await tester.s3
      .getS3Client()
      .send(new PutObjectCommand({ Bucket: 'cleanup-private', Key: canonicalKey, Body: bytes }));
    if (phase === 'prepare')
      await runtime.runPromise(
        SourceBytes.use((storage) => storage.put(candidateId, bytes, digest))
      );
    pending = runtime.runPromise(
      SourceBytes.use((storage) =>
        phase === 'upload'
          ? storage.put(candidateId, bytes, digest)
          : storage.prepare(candidateId, sourceId, 'asset', facts)
      )
    );
    void pending.catch(() => undefined);
    await held;
    await runtime.runPromise(
      CleanupBytes.use((cleanup) => cleanup.reclaim({ kind: 'candidate', candidateId }))
    );
    await runtime.runPromise(
      CleanupBytes.use((cleanup) => cleanup.reclaim({ kind: 'source', assetId: 'asset', sourceId }))
    );
    expect(lost).toBe(true);
    release();
    await expect(pending).rejects.toBeDefined();
    for (const key of [
      canonicalKey,
      `asset-layout-1/private/candidates/${candidateId}/input`,
      `asset-layout-1/assets/asset/sources/${sourceId}/original`,
    ]) {
      const head = await tester.s3
        .getS3Client()
        .send(new HeadObjectCommand({ Bucket: 'cleanup-private', Key: key }));
      expect(head.ContentLength).toBe(0);
      expect(head.Metadata).toEqual({ reclaimed: 'true' });
    }
    expect(
      await runtime.runPromise(
        Effect.exit(SourceBytes.use((storage) => storage.read(sourceId, 'asset')))
      )
    ).toMatchObject({ _tag: 'Failure' });
  } finally {
    release();
    await pending?.catch(() => undefined);
    await runtime.dispose();
    proxy.closeAllConnections();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  }
});

it('bounds an unopened consumer and reports storage stream closure after cancellation or EOF', async () => {
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
  const bytes = new Uint8Array([5, 6, 7, 8]);
  const digest = createHash('sha256').update(bytes).digest('hex');
  try {
    await runtime.runPromise(
      Effect.gen(function* () {
        const storage = yield* SourceBytes;
        yield* storage.put('read-input', bytes, digest);
        yield* storage.prepare('read-input', 'read-source', 'read-asset', {
          digest,
          byteLength: 4,
          model: 'sdr-png',
          mimeType: 'image/png',
          width: 2,
          height: 2,
        });
        const idle = yield* storage.read('read-source', 'read-asset', 30);
        yield* idle.closed.pipe(Effect.timeout('2 seconds'));
        const cancelled = yield* storage.read('read-source', 'read-asset', 1000);
        yield* cancelled.close();
        yield* cancelled.closed.pipe(Effect.timeout('2 seconds'));
        const eof = yield* storage.read('read-source', 'read-asset', 1000);
        const chunks: Uint8Array[] = [];
        yield* Effect.promise(async () => {
          for await (const chunk of eof.bytes) chunks.push(chunk);
        });
        yield* eof.closed.pipe(Effect.timeout('2 seconds'));
        expect(Buffer.concat(chunks)).toEqual(Buffer.from(bytes));
      })
    );
  } finally {
    await runtime.dispose();
  }
});

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
