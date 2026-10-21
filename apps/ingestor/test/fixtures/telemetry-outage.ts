import assert from 'node:assert/strict';
import { createHook } from 'node:async_hooks';
import { createSocket } from 'node:dgram';
import { createServer, type Server } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { metrics, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { Effect, Exit, Layer, ManagedRuntime, Scope } from 'effect';

function recordPhase(phase: string, startedAt: number) {
  if (process.env.CI_RUNTIME_PROFILE !== 'true') return;
  console.log(
    JSON.stringify({
      kind: 'ci-runtime-profile',
      phase: `ingestor.telemetry.${phase}`,
      service: process.env.TELEMETRY_SERVICE ?? 'ingestor',
      outage: process.env.TELEMETRY_OUTAGE_MODE ?? 'unresolved',
      startedAt: new Date(performance.timeOrigin + startedAt).toISOString(),
      durationMs: performance.now() - startedAt,
      pid: process.pid,
      ...(phase === 'process' ? { maxRssKiB: process.resourceUsage().maxRSS } : {}),
    })
  );
}

recordPhase('imports.bootstrap', 0);
const service = process.env.TELEMETRY_SERVICE ?? 'ingestor';
assert(
  ['ingestor', 'gateway', 'media', 'user', 'tags', 'color-extractor', 'variant-generator'].includes(
    service
  )
);
const telemetryImportStartedAt = performance.now();
const { initializeOtel } = await import(
  new URL(`../../../${service}/src/otel-init.ts`, import.meta.url).href
);
recordPhase('imports.telemetry', telemetryImportStartedAt);

// This entire process runs in an owned container with its own resolver configuration.
// Drop collector DNS packets, while localhost remains a healthy /etc/hosts dependency.
const infrastructureStartedAt = performance.now();
const dns = createSocket('udp4');
const outage = process.env.TELEMETRY_OUTAGE_MODE ?? 'unresolved';
let resolving = outage !== 'unresolved';
let healthy = outage === 'ip';
let queries = 0;
const lookups = new Set<number>();
createHook({
  init(id, type) {
    if (type === 'GETADDRINFOREQWRAP') lookups.add(id);
  },
  destroy(id) {
    lookups.delete(id);
  },
}).enable();
dns.on('message', (query, peer) => {
  queries++;
  if (!resolving) return;
  let end = 12;
  while (query[end] !== 0) end += (query[end] ?? 0) + 1;
  end += 5;
  const question = query.subarray(12, end);
  const ipv4 = query.readUInt16BE(end - 4) === 1;
  const header = Buffer.from(query.subarray(0, 12));
  header.writeUInt16BE(0x8180, 2);
  header.writeUInt16BE(ipv4 ? 1 : 0, 6);
  const answer = Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 0, 0, 4, 127, 0, 0, 1]);
  dns.send(Buffer.concat([header, question, ...(ipv4 ? [answer] : [])]), peer.port, peer.address);
});
await new Promise<void>((resolve) => dns.bind(53, '127.0.0.1', resolve));

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  return address.port;
}
async function until(check: () => boolean, timeout = 12_000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    assert(Date.now() < deadline, 'Timed out awaiting observable telemetry activity');
    await delay(20);
  }
}
const exports = new Set<string>();
let attempts = 0;
const collector = createServer((request, response) => {
  request.resume();
  request.on('end', () => {
    attempts++;
    if (healthy) {
      exports.add(request.url ?? '');
      response.end('{}');
    } else if (outage === 'stalled') {
      response.writeHead(200);
      response.write(' ');
      const stream = setInterval(() => response.write(' '), 25);
      response.once('close', () => clearInterval(stream));
    } else {
      response.writeHead(503, { 'retry-after': '0' });
      response.end('private collector failure');
    }
  });
});
const collectorPort = await listen(collector);
if (outage === 'refused') await new Promise<void>((resolve) => collector.close(() => resolve()));
const objects = new Map<string, Buffer>();
let storageConnections = 0;
const storage = createServer((request, response) => {
  response.setHeader('connection', 'close');
  const chunks: Buffer[] = [];
  request.on('data', (chunk: Buffer) => chunks.push(chunk));
  request.on('end', () => {
    if (request.method === 'PUT') objects.set(request.url ?? '', Buffer.concat(chunks));
    response.end();
  });
});
storage.on('connection', () => storageConnections++);
const storagePort = await listen(storage);
const scope = Effect.runSync(Scope.make());
recordPhase('setup.infrastructure', infrastructureStartedAt);
let pulse: ReturnType<typeof setInterval> | undefined;
try {
  const telemetryStartedAt = performance.now();
  assert.deepEqual(
    await Effect.runPromise(
      initializeOtel({
        otelServiceName: `${service}-outage`,
        otelEndpoint: `http://${outage === 'ip' ? '127.0.0.1' : 'collector.test'}:${collectorPort}`,
      }).pipe(Scope.provide(scope))
    ),
    { _tag: 'Started' }
  );
  recordPhase('setup.telemetry', telemetryStartedAt);
  const applicationImportStartedAt = performance.now();
  const { assetsLayer } = await import('../../src/adapters/assets/index.js');
  const { AssetStorage } = await import('../../src/capabilities/ingestion/index.js');
  const { fixture, metadata } = await import('../helpers/ingestion.js');
  const { createHttpApp } = await import('../../src/http/index.js');
  const { Admission } = await import('../../src/capabilities/admission/index.js');
  const { availabilityLayer, AvailabilityProbe } = await import(
    '../../src/capabilities/availability/index.js'
  );
  recordPhase('imports.application', applicationImportStartedAt);
  const applicationStartedAt = performance.now();
  const assets = ManagedRuntime.make(
    assetsLayer({
      endpoint: `http://localhost:${storagePort}`,
      region: 'us-east-1',
      accessKeyId: 'test',
      secretAccessKey: 'test',
      bucket: 'outage',
    })
  );
  try {
    const storageAdapter = await assets.runPromise(AssetStorage);
    const controlled = fixture({
      storage: {
        put: (input) => storageAdapter.put(input),
        exists: (reference) => storageAdapter.exists(reference),
        remove: (reference) => storageAdapter.remove(reference),
        list: (cursor) => storageAdapter.list(cursor),
      },
      inspection: {
        inspect: (bytes) =>
          Effect.succeed({
            _tag: 'Inspected',
            metadata: { ...metadata, contentHash: Buffer.from(bytes).toString('hex') },
          }),
      },
    });
    const app = await createHttpApp(
      { nodeEnv: 'test', rateLimitMax: 100 },
      Layer.mergeAll(
        controlled.layer,
        Layer.succeed(Admission, {
          admit: () => Effect.succeed({ _tag: 'Allowed', remaining: 99, reset: 1000 }),
        }),
        availabilityLayer.pipe(
          Layer.provide(
            Layer.succeed(AvailabilityProbe, {
              inspect: () => Effect.succeed({ database: true, s3: true, nats: true, otel: true }),
            })
          )
        )
      ),
      { logger: false }
    );
    try {
      const address = await app.listen({ host: '127.0.0.1', port: 0 });
      recordPhase('setup.application', applicationStartedAt);
      const outageStartedAt = performance.now();
      const emit = () => {
        trace.getTracer('outage').startSpan('upload.activity').end();
        logs.getLogger('outage').emit({ body: 'outage activity' });
      };
      metrics.getMeter('outage').createCounter('outage.activity').add(1);
      const provider = metrics.getMeterProvider();
      assert('forceFlush' in provider && typeof provider.forceFlush === 'function');
      const metricExport = provider.forceFlush();
      pulse = setInterval(emit, 50);
      emit();
      await until(() => lookups.size >= 4 || queries >= 6 || attempts >= 4);
      recordPhase('outage', outageStartedAt);
      console.log(
        JSON.stringify({
          phase: 'exporter-dns-active',
          queries,
          pendingSystemLookups: lookups.size,
          outage,
          service,
        })
      );
      const before = storageConnections;
      const started = Date.now();
      const uploadStartedAt = performance.now();
      const response = await fetch(`${address}/upload`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${Buffer.from(JSON.stringify({ id: 'outage-profile' })).toString('base64')}`,
          'content-type': 'multipart/form-data; boundary=file',
        },
        body: Buffer.from(
          '--file\r\nContent-Disposition: form-data; name="file"; filename="test.png"\r\nContent-Type: image/png\r\n\r\nimage\r\n--file--\r\n'
        ),
        signal: AbortSignal.timeout(15_000),
      });
      const receipt = await response.json();
      recordPhase('upload', uploadStartedAt);
      console.log(
        JSON.stringify({
          phase: 'upload-during-dns-outage',
          status: response.status,
          elapsedMs: Date.now() - started,
          freshStorageConnections: storageConnections - before,
          objects: objects.size,
        })
      );
      const recoveryStartedAt = performance.now();
      resolving = true;
      healthy = true;
      if (outage === 'refused')
        await new Promise<void>((resolve) => collector.listen(collectorPort, '127.0.0.1', resolve));
      await metricExport;
      await provider.forceFlush();
      await until(() => exports.size === 3, 30_000);
      console.log(JSON.stringify({ phase: 'collector-restored', exports: [...exports].sort() }));
      assert.equal(response.status, 200, 'Telemetry DNS must not turn uploads into HTTP 503');
      assert(receipt && typeof receipt === 'object' && 'status' in receipt);
      assert.equal(receipt.status, 'processing');
      assert.equal(objects.size, 1);
      assert.equal([...objects.values()][0]?.toString(), 'image');
      assert(storageConnections > before, 'Upload must open a fresh storage connection');
      recordPhase('recovery', recoveryStartedAt);
    } finally {
      const cleanupStartedAt = performance.now();
      try {
        if (pulse) clearInterval(pulse);
        await app.close();
      } finally {
        recordPhase('cleanup.application', cleanupStartedAt);
      }
    }
  } finally {
    const cleanupStartedAt = performance.now();
    try {
      await assets.dispose();
    } finally {
      recordPhase('cleanup.assets', cleanupStartedAt);
    }
  }
} finally {
  const cleanupStartedAt = performance.now();
  try {
    resolving = true;
    await Effect.runPromise(Scope.close(scope, Exit.void));
    objects.clear();
    dns.close();
    collector.closeAllConnections();
    storage.closeAllConnections();
    await Promise.all(
      [collector, storage].map(
        (server) => new Promise<void>((resolve) => server.close(() => resolve()))
      )
    );
  } finally {
    recordPhase('cleanup.infrastructure', cleanupStartedAt);
    recordPhase('process', 0);
  }
}
