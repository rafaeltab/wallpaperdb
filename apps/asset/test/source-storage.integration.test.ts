import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
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
import { initialSourcePolicies } from '../src/capabilities/sources/index.js';
const Tester = createDefaultTesterBuilder().with(DockerTesterBuilder).with(S3TesterBuilder).build();
const tester = new Tester().withS3().withS3Bucket('source-private');
beforeAll(() => tester.setup(), 60000);
afterAll(() => tester.destroy());
function pngChunk(kind: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length);
  chunk.write(kind, 4, 'ascii');
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  return chunk;
}
it('admits a full-range sRGB cICP PNG through mandatory inspection just like the matching plain SDR PNG', async () => {
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
  const plain = await sharp({ create: { width: 3, height: 2, channels: 3, background: 'red' } })
    .png()
    .toBuffer();
  // PNG cICP contains primaries, transfer, RGB matrix and full-range flag.
  const chunk = pngChunk('cICP', Buffer.from([1, 13, 0, 1]));
  const signalled = Buffer.concat([plain.subarray(0, 33), chunk, plain.subarray(33)]);
  try {
    for (const [id, bytes] of [
      ['candidate_plain_sdr', plain],
      ['candidate_cicp_sdr', signalled],
    ] as const) {
      const digest = createHash('sha256').update(bytes).digest('hex');
      await runtime.runPromise(SourceBytes.use((storage) => storage.put(id, bytes, digest)));
      expect(
        await runtime.runPromise(
          MandatoryInspection.use((inspector) =>
            inspector.inspect(id, initialSourcePolicies.wallpaper)
          )
        )
      ).toMatchObject({
        kind: 'verified',
        facts: {
          model: 'sdr-png',
          mimeType: 'image/png',
          width: 3,
          height: 2,
          digest,
          byteLength: bytes.length,
        },
      });
    }
  } finally {
    await runtime.dispose();
  }
});
it('keeps HDR, unknown, malformed cICP and APNG outside supported SDR PNG inspection', async () => {
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
  const plain = await sharp({ create: { width: 3, height: 2, channels: 3, background: 'red' } })
    .png()
    .toBuffer();
  const insert = (...chunks: Buffer[]) =>
    Buffer.concat([plain.subarray(0, 33), ...chunks, plain.subarray(33)]);
  const sdr = pngChunk('cICP', Buffer.from([1, 13, 0, 1]));
  const corrupt = Buffer.from(sdr);
  corrupt.writeUInt32BE((corrupt.readUInt32BE(corrupt.length - 4) ^ 1) >>> 0, corrupt.length - 4);
  // A one-frame APNG uses this PNG's actual default image as its first frame.
  const frame = Buffer.alloc(26);
  frame.writeUInt32BE(3, 4);
  frame.writeUInt32BE(2, 8);
  frame.writeUInt16BE(1, 20);
  frame.writeUInt16BE(10, 22);
  const fixtures = [
    {
      id: 'hlg',
      bytes: insert(pngChunk('cICP', Buffer.from([9, 18, 0, 1]))),
      reason: 'unsupported-source-model',
    },
    {
      id: 'unknown-primaries',
      bytes: insert(pngChunk('cICP', Buffer.from([2, 13, 0, 1]))),
      reason: 'unsupported-source-model',
    },
    {
      id: 'unknown-transfer',
      bytes: insert(pngChunk('cICP', Buffer.from([1, 2, 0, 1]))),
      reason: 'unsupported-source-model',
    },
    {
      id: 'unsupported-matrix',
      bytes: insert(pngChunk('cICP', Buffer.from([1, 13, 1, 1]))),
      reason: 'unsupported-source-model',
    },
    {
      id: 'narrow-range',
      bytes: insert(pngChunk('cICP', Buffer.from([1, 13, 0, 0]))),
      reason: 'unsupported-source-model',
    },
    {
      id: 'short-cicp',
      bytes: insert(pngChunk('cICP', Buffer.from([1, 13, 0]))),
      reason: 'invalid-image',
    },
    { id: 'corrupt-cicp', bytes: insert(corrupt), reason: 'invalid-image' },
    { id: 'duplicate-cicp', bytes: insert(sdr, sdr), reason: 'invalid-image' },
    {
      id: 'late-cicp',
      bytes: Buffer.concat([plain.subarray(0, -12), sdr, plain.subarray(-12)]),
      reason: 'invalid-image',
    },
    {
      id: 'apng',
      bytes: insert(
        pngChunk('acTL', Buffer.from([0, 0, 0, 1, 0, 0, 0, 0])),
        pngChunk('fcTL', frame)
      ),
      reason: 'unsupported-source-model',
    },
  ];
  try {
    for (const fixture of fixtures) {
      const id = `candidate_png_${fixture.id}`;
      await runtime.runPromise(
        SourceBytes.use((storage) =>
          storage.put(id, fixture.bytes, createHash('sha256').update(fixture.bytes).digest('hex'))
        )
      );
      expect(
        await runtime.runPromise(
          MandatoryInspection.use((inspector) =>
            inspector.inspect(id, initialSourcePolicies.wallpaper)
          )
        ),
        fixture.id
      ).toEqual({ kind: 'rejected', reason: fixture.reason });
    }
  } finally {
    await runtime.dispose();
  }
});
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
          yield* Effect.exit(
            storage.put(
              'candidate_1',
              new Uint8Array([9, 8, 7]),
              createHash('sha256')
                .update(new Uint8Array([9, 8, 7]))
                .digest('hex')
            )
          )
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

it('reconciles a lost successful conditional-write response against authoritative immutable metadata', async () => {
  const { createServer, request } = await import('node:http');
  const s3 = tester.getS3();
  const target = new URL(s3.endpoints.fromHost);
  let lost = false;
  const proxy = createServer((incoming, outgoing) => {
    const forwarded = request(
      {
        hostname: target.hostname,
        port: target.port,
        path: incoming.url,
        method: incoming.method,
        headers: incoming.headers,
      },
      (response) => {
        if (incoming.method === 'PUT' && !lost && response.statusCode === 200) {
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
  });
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  const address = proxy.address();
  if (!address || typeof address === 'string') throw new Error('Missing proxy address');
  const runtime = ManagedRuntime.make(
    sourceStorageLayer({
      endpoint: `http://127.0.0.1:${address.port}`,
      region: 'us-east-1',
      accessKeyId: s3.options.accessKey,
      secretAccessKey: s3.options.secretKey,
      bucket: 'source-private',
    })
  );
  const png = await sharp({ create: { width: 2, height: 3, channels: 3, background: 'blue' } })
    .png()
    .toBuffer();
  try {
    const digest = createHash('sha256').update(png).digest('hex');
    await runtime.runPromise(
      SourceBytes.use((bytes) => bytes.put('candidate_lost_response', png, digest))
    );
    expect(lost).toBe(true);
    const inspected = await runtime.runPromise(
      MandatoryInspection.use((inspector) =>
        inspector.inspect('candidate_lost_response', initialSourcePolicies.wallpaper)
      )
    );
    expect(inspected).toMatchObject({ kind: 'verified', facts: { digest, width: 2, height: 3 } });
    if (inspected.kind !== 'verified') throw new Error('Expected verified bytes');
    await runtime.runPromise(
      SourceBytes.use((bytes) =>
        bytes.prepare(
          'candidate_lost_response',
          'source_lost_response',
          'asset_ambiguous',
          inspected.facts
        )
      )
    );
    const original = await runtime.runPromise(
      SourceBytes.use((bytes) => bytes.read('source_lost_response', 'asset_ambiguous'))
    );
    const chunks = [];
    for await (const chunk of original.bytes) chunks.push(chunk);
    await runtime.runPromise(original.close());
    expect(Buffer.concat(chunks)).toEqual(png);
  } finally {
    await runtime.dispose();
    proxy.closeAllConnections();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  }
});
it('rejects an ISO gain-map APP2 declaration without relying on APP1 or MPF metadata', async () => {
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
  const jpeg = await sharp({ create: { width: 3, height: 2, channels: 3, background: 'green' } })
    .jpeg()
    .toBuffer();
  const header = Buffer.from('urn:iso:std:iso:ts:21496:-1\0');
  const marker = Buffer.alloc(4);
  marker[0] = 0xff;
  marker[1] = 0xe2;
  marker.writeUInt16BE(header.length + 2, 2);
  const fixture = Buffer.concat([jpeg.subarray(0, 2), marker, header, jpeg.subarray(2)]);
  try {
    await runtime.runPromise(
      SourceBytes.use((bytes) =>
        bytes.put(
          'candidate_iso_declaration',
          fixture,
          createHash('sha256').update(fixture).digest('hex')
        )
      )
    );
    expect(
      await runtime.runPromise(
        MandatoryInspection.use((inspector) =>
          inspector.inspect('candidate_iso_declaration', initialSourcePolicies.wallpaper)
        )
      )
    ).toEqual({ kind: 'rejected', reason: 'unsupported-source-model' });
  } finally {
    await runtime.dispose();
  }
});
it('reports mandatory displayed-geometry rejection as a normal result', async () => {
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
  const png = await sharp({ create: { width: 20001, height: 1, channels: 3, background: 'red' } })
    .png()
    .toBuffer();
  try {
    await runtime.runPromise(
      SourceBytes.use((bytes) =>
        bytes.put('candidate_axis_limit', png, createHash('sha256').update(png).digest('hex'))
      )
    );
    expect(
      await runtime.runPromise(
        MandatoryInspection.use((inspector) =>
          inspector.inspect('candidate_axis_limit', initialSourcePolicies.wallpaper)
        )
      )
    ).toEqual({ kind: 'rejected', reason: 'geometry-limit' });
  } finally {
    await runtime.dispose();
  }
});
it.each([
  'request cancellation',
  'runtime shutdown',
] as const)('kills and reaps actual inspection during %s', async (mode) => {
  const { createServer, request } = await import('node:http');
  const { readFile, readdir } = await import('node:fs/promises');
  const children = async () => {
    const threads = await readdir(`/proc/${process.pid}/task`);
    const groups = await Promise.all(
      threads.map((thread) =>
        readFile(`/proc/${process.pid}/task/${thread}/children`, 'utf8').catch(() => '')
      )
    );
    return new Set(
      groups.flatMap((group) => group.trim().split(/\s+/).filter(Boolean).map(Number))
    );
  };
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const s3 = tester.getS3();
  const target = new URL(s3.endpoints.fromHost);
  let entered!: () => void;
  const stalled = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release = () => {};
  // Keep a real S3 response open so the production inspection child stays active deterministically.
  const proxy = createServer((incoming, outgoing) => {
    const forwarded = request(
      {
        hostname: target.hostname,
        port: target.port,
        path: incoming.url,
        method: incoming.method,
        headers: incoming.headers,
      },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        if (incoming.method !== 'GET') {
          response.pipe(outgoing);
          return;
        }
        response.once('readable', () => {
          const first: unknown = response.read(1);
          if (Buffer.isBuffer(first)) outgoing.write(first);
          outgoing.flushHeaders();
          response.pause();
          release = () => response.pipe(outgoing);
          entered();
        });
        outgoing.once('close', () => response.destroy());
      }
    );
    forwarded.on('error', () => outgoing.destroy());
    incoming.pipe(forwarded);
  });
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  const address = proxy.address();
  if (!address || typeof address === 'string') throw new Error('Missing address');
  const runtime = ManagedRuntime.make(
    sourceStorageLayer({
      endpoint: `http://127.0.0.1:${address.port}`,
      region: 'us-east-1',
      accessKeyId: s3.options.accessKey,
      secretAccessKey: s3.options.secretKey,
      bucket: 'source-private',
    })
  );
  const png = await sharp({ create: { width: 3, height: 2, channels: 3, background: 'red' } })
    .png()
    .toBuffer();
  const controller = new AbortController();
  let pending: Promise<unknown> | undefined;
  try {
    const id =
      mode === 'request cancellation' ? 'candidate_native_cancel' : 'candidate_native_shutdown';
    await runtime.runPromise(
      SourceBytes.use((bytes) => bytes.put(id, png, createHash('sha256').update(png).digest('hex')))
    );
    const baseline = await children();
    pending = runtime.runPromise(
      MandatoryInspection.use((inspector) =>
        inspector.inspect(id, initialSourcePolicies.wallpaper)
      ),
      { signal: controller.signal }
    );
    void pending.catch(() => undefined);
    await stalled;
    let child: number | undefined;
    await expect
      .poll(async () => {
        child = [...(await children())].find((pid) => !baseline.has(pid));
        return child !== undefined;
      })
      .toBe(true);
    if (child === undefined) throw new Error('Missing native inspection process');
    const pid = child;
    expect(alive(pid)).toBe(true);
    if (mode === 'request cancellation') controller.abort();
    else await runtime.dispose();
    await expect(pending).rejects.toBeDefined();
    await expect.poll(() => alive(pid)).toBe(false);
  } finally {
    controller.abort();
    release();
    await pending?.catch(() => undefined);
    await runtime.dispose();
    proxy.closeAllConnections();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  }
});
