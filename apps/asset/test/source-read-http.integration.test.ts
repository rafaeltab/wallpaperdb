import { createHash } from 'node:crypto';
import { createServer, get, request } from 'node:http';
import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  S3TesterBuilder,
} from '@wallpaperdb/test-utils';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sourceStorageLayer } from '../src/adapters/sources/index.js';
import {
  SourceBytes,
  SourceStore,
  sourcesLayer,
  initialSourcePolicies,
  type SourceState,
} from '../src/capabilities/sources/index.js';
import { AuthorAuthentication } from '../src/adapters/authors/index.js';
import { Availability } from '../src/capabilities/availability/index.js';
import { AssetDelivery } from '../src/capabilities/delivery/index.js';
import { createHttpApp } from '../src/http/index.js';

const Tester = createDefaultTesterBuilder().with(DockerTesterBuilder).with(S3TesterBuilder).build();
const tester = new Tester().withS3().withS3Bucket('read-private');
beforeAll(() => tester.setup(), 60000);
afterAll(() => tester.destroy());

it.each([
  'hung',
  'failed',
] as const)('closes a %s actual S3/HTTP stream and promptly releases its accepted protection', async (mode) => {
  const s3 = tester.getS3(),
    owner = { namespace: 'test', subject: 'owner' },
    upstream = new URL(s3.endpoints.fromHost);
  const active = new Set<import('node:http').IncomingMessage>();
  const proxy = createServer((incoming, outgoing) => {
    const forwarded = request(
      {
        hostname: upstream.hostname,
        port: upstream.port,
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
        active.add(response);
        response.once('close', () => active.delete(response));
        outgoing.once('close', () => response.destroy());
        response.once('readable', () => {
          const first: unknown = response.read(1);
          if (Buffer.isBuffer(first)) outgoing.write(first);
          outgoing.flushHeaders();
          response.pause();
          if (mode === 'failed') setImmediate(() => outgoing.destroy());
        });
      }
    );
    forwarded.on('error', () => outgoing.destroy());
    incoming.pipe(forwarded);
  });
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  const proxyAddress = proxy.address();
  if (!proxyAddress || typeof proxyAddress === 'string') throw new Error('Missing proxy');
  const storage = sourceStorageLayer({
    endpoint: `http://127.0.0.1:${proxyAddress.port}`,
    region: 'us-east-1',
    accessKeyId: s3.options.accessKey,
    secretAccessKey: s3.options.secretKey,
    bucket: 'read-private',
  });
  const runtime = ManagedRuntime.make(storage);
  const input = new Uint8Array(1048576).fill(81),
    digest = createHash('sha256').update(input).digest('hex');
  const sourceId = `source-${mode}`,
    facts = {
      digest,
      byteLength: input.length,
      mimeType: 'image/png',
      model: 'sdr-png',
      width: 2,
      height: 2,
    };
  const reads = new Set<string>();
  const state: SourceState = {
    asset: { id: 'asset', applicationId: 'wallpaper', assetType: 'wallpaper', owner },
    sourceSetRevision: '1',
    deliveryRevision: '1',
    defaultSourceId: sourceId,
    initialAnalysisSourceId: sourceId,
    candidates: [],
    nonterminalCandidateCount: 0,
    sources: [{ sourceId, layout: 'asset-layout-1', facts }],
  };
  const sourceServices = sourcesLayer({
    revision: 'one',
    types: initialSourcePolicies,
    readLifetimeMs: 100,
  }).pipe(
    Layer.provide(
      Layer.merge(
        storage,
        Layer.succeed(SourceStore, {
          transact: (_id, _revision, change) =>
            Effect.sync(() => {
              const result = change(structuredClone(state));
              if (result.readProtection) reads.add(result.readProtection.readId);
              return result.result;
            }),
          releaseRead: (id) =>
            Effect.sync(() => {
              reads.delete(id);
            }),
        })
      )
    )
  );
  const app = await createHttpApp(
    { nodeEnv: 'test', port: 3003 },
    Layer.merge(
      Layer.succeed(Availability, {
        health: () => Effect.die('unused'),
        ready: () => Effect.die('unused'),
      }),
      Layer.succeed(AssetDelivery, {
        wallpaper: () => Effect.die('unused'),
        picture: () => Effect.die('unused'),
      })
    ),
    {
      sourceServices: Layer.merge(
        sourceServices,
        Layer.succeed(AuthorAuthentication, { verify: () => Effect.succeed(owner) })
      ),
    }
  );
  try {
    // Seed directly against storage; a blocked GET is installed only for the actual original read.
    const direct = ManagedRuntime.make(
      sourceStorageLayer({
        endpoint: s3.endpoints.fromHost,
        region: 'us-east-1',
        accessKeyId: s3.options.accessKey,
        secretAccessKey: s3.options.secretKey,
        bucket: 'read-private',
      })
    );
    try {
      await direct.runPromise(
        SourceBytes.use((bytes) =>
          bytes
            .put(`input-${mode}`, input, digest)
            .pipe(Effect.andThen(bytes.prepare(`input-${mode}`, sourceId, 'asset', facts)))
        )
      );
    } finally {
      await direct.dispose();
    }
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const guard = AbortSignal.timeout(3000);
    const response = await fetch(`${address}/assets/asset/sources/${sourceId}/original`, {
      signal: guard,
    });
    expect(response.status).toBe(200);
    await expect(response.arrayBuffer()).rejects.toBeDefined();
    expect(guard.aborted).toBe(false);
    await expect.poll(() => reads.size).toBe(0);
    await expect.poll(() => active.size).toBe(0);
  } finally {
    await app.close();
    await runtime.dispose();
    for (const response of active) response.destroy();
    proxy.closeAllConnections();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  }
});

it('streams the 50 MiB configured encoded ceiling over real HTTP and releases protection on EOF and cancellation', async () => {
  const s3 = tester.getS3(),
    owner = { namespace: 'test', subject: 'owner' };
  const storage = sourceStorageLayer({
    endpoint: s3.endpoints.fromHost,
    region: 'us-east-1',
    accessKeyId: s3.options.accessKey,
    secretAccessKey: s3.options.secretKey,
    bucket: 'read-private',
  });
  const runtime = ManagedRuntime.make(storage);
  // An opaque storage fixture measures the byte path, not image admission/native processing.
  const input = new Uint8Array(52428800).fill(37),
    digest = createHash('sha256').update(input).digest('hex');
  const facts = {
    digest,
    byteLength: input.length,
    mimeType: 'image/png',
    model: 'sdr-png',
    width: 2,
    height: 2,
  };
  const state: SourceState = {
    asset: { id: 'asset', applicationId: 'wallpaper', assetType: 'wallpaper', owner },
    sourceSetRevision: '1',
    deliveryRevision: '1',
    defaultSourceId: 'source',
    initialAnalysisSourceId: 'source',
    candidates: [],
    nonterminalCandidateCount: 0,
    sources: [{ sourceId: 'source', layout: 'asset-layout-1', facts }],
  };
  const reads = new Set<string>();
  const sourceServices = sourcesLayer({
    revision: 'read',
    types: initialSourcePolicies,
    readLifetimeMs: 5000,
  }).pipe(
    Layer.provide(
      Layer.merge(
        storage,
        Layer.succeed(SourceStore, {
          transact: (_id, _revision, change) =>
            Effect.sync(() => {
              const result = change(structuredClone(state));
              if (result.readProtection) reads.add(result.readProtection.readId);
              return result.result;
            }),
          releaseRead: (id) =>
            Effect.sync(() => {
              reads.delete(id);
            }),
        })
      )
    )
  );
  const app = await createHttpApp(
    { nodeEnv: 'test', port: 3003 },
    Layer.merge(
      Layer.succeed(Availability, {
        health: () => Effect.die('unused'),
        ready: () => Effect.die('unused'),
      }),
      Layer.succeed(AssetDelivery, {
        wallpaper: () => Effect.die('unused'),
        picture: () => Effect.die('unused'),
      })
    ),
    {
      sourceServices: Layer.merge(
        sourceServices,
        Layer.succeed(AuthorAuthentication, { verify: () => Effect.succeed(owner) })
      ),
    }
  );
  try {
    await runtime.runPromise(
      SourceBytes.use((bytes) =>
        bytes
          .put('input', input, digest)
          .pipe(Effect.andThen(bytes.prepare('input', 'source', 'asset', facts)))
      )
    );
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const started = performance.now();
    const response = await fetch(`${address}/assets/asset/sources/source/original`);
    expect(response.status).toBe(200);
    const hash = createHash('sha256');
    let count = 0;
    if (!response.body) throw new Error('Missing stream');
    for await (const chunk of response.body) {
      hash.update(chunk);
      count += chunk.length;
    }
    const elapsedMs = performance.now() - started;
    expect(count).toBe(52428800);
    expect(hash.digest('hex')).toBe(digest);
    await expect.poll(() => reads.size).toBe(0);
    console.info(
      JSON.stringify({
        qualification: 'local HTTP plus Seaweed exact byte stream only',
        byteLength: count,
        elapsedMs: Math.round(elapsedMs),
        enforcedTestLifetimeMs: 5000,
      })
    );
    await new Promise<void>((resolve, reject) => {
      const request = get(`${address}/assets/asset/sources/source/original`, (response) => {
        response.once('data', () => {
          response.destroy();
          resolve();
        });
        response.on('error', () => undefined);
      });
      request.on('error', reject);
    });
    await expect.poll(() => reads.size).toBe(0);
  } finally {
    await app.close();
    await runtime.dispose();
  }
});
