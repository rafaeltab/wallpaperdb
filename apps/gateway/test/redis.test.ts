import { once } from 'node:events';
import { connect, createServer, type Socket } from 'node:net';
import { metrics } from '@opentelemetry/api';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { Deferred, Effect, Layer, ManagedRuntime } from 'effect';
import Redis from 'ioredis';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestHttpApp, EmptyCatalogue, httpConfig } from './unit/http-fixture.js';
import { admissionTelemetryLayer } from '../src/adapters/admission-telemetry/index.js';
import { redisQuotaLayer } from '../src/adapters/redis/index.js';
import {
  Admission,
  admissionLayer,
  type AdmissionResult,
  type QuotaUnavailable,
  Quota,
} from '../src/capabilities/admission/index.js';

let container: StartedTestContainer;
beforeAll(async () => {
  container = await new GenericContainer('redis:7-alpine').withExposedPorts(6379).start();
});
afterAll(async () => {
  await container?.stop();
});
async function distributed(port = container.getMappedPort(6379), enabled = true) {
  const runtime = ManagedRuntime.make(
    redisQuotaLayer({ redisEnabled: enabled, redisHost: '127.0.0.1', redisPort: port })
  );
  const quota = await runtime.runPromise(Quota);
  return {
    quota: {
      take: (...args: Parameters<Quota['take']>) =>
        quota.take(...args).pipe(Effect.catchTag('QuotaUnavailable', Effect.succeed)),
    },
    dispose: () => runtime.dispose(),
  };
}
function observeQuotaMetrics() {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 });
  const provider = new MeterProvider({ readers: [reader] });
  metrics.setGlobalMeterProvider(provider);
  return {
    async read() {
      await provider.forceFlush();
      return exporter.getMetrics().flatMap((resource) =>
        resource.scopeMetrics.flatMap((scope) =>
          scope.metrics
            .filter(
              (metric) =>
                metric.descriptor.name === 'admission.quota.unavailable' ||
                metric.descriptor.name === 'admission.quota.saturated'
            )
            .flatMap((metric) =>
              metric.dataPoints.map((point) => ({
                attributes: point.attributes,
                value: point.value,
              }))
            )
        )
      );
    },
    async close() {
      metrics.disable();
      await provider.shutdown();
    },
  };
}
async function proxy() {
  let forwardsReplies = true;
  let holdsReplies = false;
  const heldReplies: Array<{ socket: Socket; chunk: Buffer }> = [];
  let acceptsConnections = true;
  let evals = 0;
  let connections = 0;
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    if (!acceptsConnections) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    connections += 1;
    const upstream = connect(container.getMappedPort(6379), '127.0.0.1');
    socket.on('data', (chunk) => {
      evals += chunk.toString().split('\r\neval\r\n').length - 1;
      upstream.write(chunk);
    });
    upstream.on('data', (chunk) => {
      if (holdsReplies) heldReplies.push({ socket, chunk });
      else if (forwardsReplies) socket.write(chunk);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
    socket.on('close', () => {
      sockets.delete(socket);
      upstream.destroy();
    });
    upstream.on('close', () => socket.destroy());
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
  return {
    port: address.port,
    get sockets() {
      return sockets.size;
    },
    get evals() {
      return evals;
    },
    get connections() {
      return connections;
    },
    stall() {
      forwardsReplies = false;
    },
    holdReplies() {
      holdsReplies = true;
    },
    releaseReplies() {
      holdsReplies = false;
      for (const { socket, chunk } of heldReplies.splice(0)) socket.write(chunk);
    },
    disconnect() {
      acceptsConnections = false;
      for (const socket of sockets) socket.destroy();
    },
    restore() {
      forwardsReplies = true;
      acceptsConnections = true;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      server.close();
      await once(server, 'close');
    },
  };
}

describe('quota storage contract', () => {
  it('refills continuously and denies weighted reservations without debiting the balance', async () => {
    const adapter = await distributed();
    const control = new Redis({ host: '127.0.0.1', port: container.getMappedPort(6379) });
    try {
      expect(
        await Effect.runPromise(adapter.quota.take('weighted-refill', 1000, 100000, 800))
      ).toMatchObject({ _tag: 'Allowed', remaining: 200 });
      const denied = await Effect.runPromise(
        adapter.quota.take('weighted-refill', 1000, 100000, 500)
      );
      expect(denied._tag).toBe('Limited');
      if (denied._tag !== 'Limited') throw new Error('Expected quota denial');
      expect(denied.retryAfter).toBeGreaterThan(29000);
      expect(denied.retryAfter).toBeLessThanOrEqual(30000);
      expect(
        await Effect.runPromise(adapter.quota.take('weighted-refill', 1000, 100000, 200))
      ).toMatchObject({ _tag: 'Allowed', remaining: 0 });
      const [seconds, micros] = await control.time();
      const now = Number(seconds) * 1000 + Math.floor(Number(micros) / 1000);
      await control.hset('graphql:quota:weighted-refill', 'updated', now - 50000, 'tokens', 0);
      const refilled = await Effect.runPromise(
        adapter.quota.take('weighted-refill', 1000, 100000, 400)
      );
      expect(refilled).toMatchObject({ _tag: 'Allowed', remaining: 100 });
      expect(await control.pttl('graphql:quota:weighted-refill')).toBeGreaterThan(0);
    } finally {
      control.disconnect();
      await adapter.dispose();
    }
  });
  it('atomically shares weighted reservations across live Redis adapters and keeps keys isolated', async () => {
    const a = await distributed();
    const b = await distributed();
    try {
      const results = await Effect.runPromise(
        Effect.all(
          Array.from({ length: 8 }, (_, i) =>
            (i % 2 ? a : b).quota.take('shared', 300, 60000000, 100)
          ),
          { concurrency: 'unbounded' }
        )
      );
      expect(results.filter((r) => r._tag === 'Allowed')).toHaveLength(3);
      expect(results.filter((r) => r._tag === 'Limited')).toHaveLength(5);
      expect(await Effect.runPromise(b.quota.take('other', 3, 60000, 1))).toMatchObject({
        _tag: 'Allowed',
        remaining: 2,
      });
    } finally {
      await a.dispose();
      await b.dispose();
    }
  });
  it('reports typed unavailability when Redis is disabled or unreachable', async () => {
    const observed = observeQuotaMetrics();
    try {
      for (const enabled of [false, true]) {
        const adapter = await distributed(1, enabled);
        try {
          for (let i = 0; i < 3; i++) {
            expect(
              await Effect.runPromise(adapter.quota.take('unavailable', 1, 60000, 1))
            ).toMatchObject({ _tag: 'QuotaUnavailable' });
          }
        } finally {
          await adapter.dispose();
        }
      }
      expect(await observed.read()).toEqual(
        expect.arrayContaining([
          { attributes: { reason: 'disabled' }, value: 3 },
          { attributes: { reason: 'unavailable' }, value: 3 },
        ])
      );
    } finally {
      await observed.close();
    }
  });
  it('reports local saturation while Redis remains healthy and completes held commands normally', async () => {
    const bridge = await proxy();
    const adapter = await distributed(bridge.port);
    const control = new Redis({ host: '127.0.0.1', port: container.getMappedPort(6379) });
    const observed = observeQuotaMetrics();
    let pending: Promise<Array<AdmissionResult | QuotaUnavailable>> | undefined;
    try {
      await control.ping();
      bridge.holdReplies();
      pending = Effect.runPromise(
        Effect.all(
          Array.from({ length: 64 }, () => adapter.quota.take('healthy-saturation', 100, 60000, 1)),
          { concurrency: 'unbounded' }
        )
      );
      await expect
        .poll(
          async () => Number(await control.hget('graphql:quota:healthy-saturation', 'tokens')),
          { interval: 5 }
        )
        .toBeCloseTo(36, 0);
      expect(await control.ping()).toBe('PONG');
      expect(
        await Effect.runPromise(adapter.quota.take('healthy-saturation', 100, 60000, 1))
      ).toMatchObject({ _tag: 'Saturated' });
      expect(Number(await control.hget('graphql:quota:healthy-saturation', 'tokens'))).toBeCloseTo(
        36,
        0
      );
      bridge.releaseReplies();
      const decisions = await pending;
      expect(
        decisions.every((decision) => decision._tag === 'Allowed' && decision.remaining < 100)
      ).toBe(true);
      expect(Number(await control.hget('graphql:quota:healthy-saturation', 'tokens'))).toBeCloseTo(
        36,
        0
      );
      expect(await observed.read()).toEqual([{ attributes: { reason: 'saturated' }, value: 1 }]);
    } finally {
      bridge.releaseReplies();
      await Promise.allSettled([pending]);
      control.disconnect();
      await adapter.dispose();
      await bridge.close();
      await observed.close();
    }
  });
  it('keeps cancelled commands bounded without disconnecting shared quota enforcement', async () => {
    const bridge = await proxy();
    const adapter = await distributed(bridge.port);
    const control = new Redis({ host: '127.0.0.1', port: container.getMappedPort(6379) });
    const observed = observeQuotaMetrics();
    const controller = new AbortController();
    let pending: Promise<unknown> | undefined;
    try {
      expect(
        await Effect.runPromise(adapter.quota.take('cancel-other', 1, 60000, 1))
      ).toMatchObject({
        _tag: 'Allowed',
        remaining: 0,
      });
      bridge.holdReplies();
      pending = Effect.runPromiseExit(
        Effect.all(
          Array.from({ length: 64 }, () => adapter.quota.take('cancel-held', 100, 60000, 1)),
          { concurrency: 'unbounded' }
        ),
        { signal: controller.signal }
      );
      await expect
        .poll(async () => Number(await control.hget('graphql:quota:cancel-held', 'tokens')), {
          interval: 5,
        })
        .toBeCloseTo(36, 0);
      controller.abort();
      expect(await control.ping()).toBe('PONG');
      expect(
        await Effect.runPromise(adapter.quota.take('cancel-held', 100, 60000, 1))
      ).toMatchObject({
        _tag: 'Saturated',
      });
      expect(await observed.read()).toEqual([{ attributes: { reason: 'saturated' }, value: 1 }]);
      expect(Number(await control.hget('graphql:quota:cancel-held', 'tokens'))).toBeCloseTo(36, 0);
      bridge.releaseReplies();
      expect(await pending).toMatchObject({ _tag: 'Failure' });
      expect(
        await Effect.runPromise(adapter.quota.take('cancel-other', 1, 60000, 1))
      ).toMatchObject({
        _tag: 'Limited',
      });
      expect(bridge.connections).toBe(1);
    } finally {
      bridge.releaseReplies();
      await Promise.allSettled([pending]);
      control.disconnect();
      await adapter.dispose();
      await bridge.close();
      await observed.close();
    }
  });
  it('distinguishes a failed Redis command from unavailable storage', async () => {
    const adapter = await distributed();
    const control = new Redis({ host: '127.0.0.1', port: container.getMappedPort(6379) });
    const observed = observeQuotaMetrics();
    try {
      await control.lpush('graphql:quota:wrong-type', 'invalid-quota-storage');
      expect(await Effect.runPromise(adapter.quota.take('wrong-type', 1, 60000, 1))).toMatchObject({
        _tag: 'QuotaUnavailable',
        reason: 'command_failure',
      });
      expect(await observed.read()).toEqual([
        { attributes: { reason: 'command_failure' }, value: 1 },
      ]);
    } finally {
      control.disconnect();
      await adapter.dispose();
      await observed.close();
    }
  });
  it('handles corrupt quota state and recovers', async () => {
    const adapter = await distributed();
    const control = new Redis({ host: '127.0.0.1', port: container.getMappedPort(6379) });
    const observed = observeQuotaMetrics();
    try {
      // Corrupt stored state must fail admission storage rather than invent a balance.
      await control.set('graphql:quota:missing-expiry', '1');
      expect(await control.pttl('graphql:quota:missing-expiry')).toBe(-1);
      expect(
        await Effect.runPromise(adapter.quota.take('missing-expiry', 1, 60000, 1))
      ).toMatchObject({
        _tag: 'QuotaUnavailable',
        reason: 'command_failure',
      });
      expect(await observed.read()).toEqual([
        { attributes: { reason: 'command_failure' }, value: 1 },
      ]);
      await control.del('graphql:quota:missing-expiry');
      await expect
        .poll(() => Effect.runPromise(adapter.quota.take('missing-expiry', 1, 60000, 1)))
        .toMatchObject({ _tag: 'Allowed', remaining: 0 });
      expect(
        await Effect.runPromise(adapter.quota.take('missing-expiry', 1, 60000, 1))
      ).toMatchObject({
        _tag: 'Limited',
      });
    } finally {
      control.disconnect();
      await adapter.dispose();
      await observed.close();
    }
  });
  it('leaves denied windows unchanged and resets after expiry', async () => {
    const adapter = await distributed();
    const control = new Redis({ host: '127.0.0.1', port: container.getMappedPort(6379) });
    try {
      expect(await Effect.runPromise(adapter.quota.take('window', 1, 60000, 1))).toMatchObject({
        _tag: 'Allowed',
        remaining: 0,
      });
      const ttl = await control.pttl('graphql:quota:window');
      expect(await Effect.runPromise(adapter.quota.take('window', 1, 60000, 1))).toMatchObject({
        _tag: 'Limited',
      });
      expect(await control.pttl('graphql:quota:window')).toBeLessThanOrEqual(ttl);
      await control.pexpire('graphql:quota:window', 1);
      await expect.poll(() => control.exists('graphql:quota:window')).toBe(0);
      expect(await Effect.runPromise(adapter.quota.take('window', 1, 60000, 1))).toMatchObject({
        _tag: 'Allowed',
        remaining: 0,
      });
    } finally {
      control.disconnect();
      await adapter.dispose();
    }
  });
  it('reports failure during a connection outage and restores distributed enforcement after reconnecting', async () => {
    const bridge = await proxy();
    const adapter = await distributed(bridge.port);
    try {
      expect(await Effect.runPromise(adapter.quota.take('reconnect', 1, 60000, 1))).toMatchObject({
        _tag: 'Allowed',
        remaining: 0,
      });
      bridge.disconnect();
      await expect
        .poll(() => Effect.runPromise(adapter.quota.take('reconnect', 1, 60000, 1)))
        .toMatchObject({ _tag: 'QuotaUnavailable' });
      bridge.restore();
      await expect
        .poll(() => Effect.runPromise(adapter.quota.take('reconnect', 1, 60000, 1)), {
          timeout: 5000,
        })
        .toMatchObject({ _tag: 'Limited' });
      await adapter.dispose();
      await expect.poll(() => bridge.sockets).toBe(0);
    } finally {
      await adapter.dispose();
      await bridge.close();
    }
  });
  it('retries an unavailable startup connection and begins enforcement when Redis returns', async () => {
    const bridge = await proxy();
    bridge.disconnect();
    const adapter = await distributed(bridge.port);
    try {
      expect(
        await Effect.runPromise(adapter.quota.take('startup-outage', 1, 60000, 1))
      ).toMatchObject({ _tag: 'QuotaUnavailable' });
      bridge.restore();
      await expect
        .poll(() => Effect.runPromise(adapter.quota.take('startup-outage', 1, 60000, 1)), {
          timeout: 5000,
        })
        .toMatchObject({ _tag: 'Allowed', remaining: 0 });
      expect(
        await Effect.runPromise(adapter.quota.take('startup-outage', 1, 60000, 1))
      ).toMatchObject({ _tag: 'Limited' });
    } finally {
      await adapter.dispose();
      await bridge.close();
    }
  });
  it('bounds stalled socket work, never replays ambiguous commands, and releases the socket on scope closure', async () => {
    const bridge = await proxy();
    const adapter = await distributed(bridge.port);
    const control = new Redis({ host: '127.0.0.1', port: container.getMappedPort(6379) });
    try {
      bridge.stall();
      const decisions = await Effect.runPromise(
        Effect.all(
          Array.from({ length: 256 }, () => adapter.quota.take('stalled', 500, 60000, 1)),
          { concurrency: 'unbounded' }
        ).pipe(Effect.timeout('3 seconds'))
      );
      expect(decisions.filter((decision) => decision._tag === 'Saturated')).toHaveLength(192);
      expect(decisions.filter((decision) => decision._tag === 'QuotaUnavailable')).toHaveLength(64);
      expect(bridge.evals).toBeLessThanOrEqual(64);
      const committed = 500 - Number(await control.hget('graphql:quota:stalled', 'tokens'));
      expect(committed).toBeGreaterThan(0);
      expect(committed).toBeLessThanOrEqual(64);
      bridge.restore();
      await expect
        .poll(() => Effect.runPromise(adapter.quota.take('recovered', 1, 60000, 1)), {
          timeout: 5000,
        })
        .toMatchObject({ _tag: 'Allowed', remaining: 0 });
      expect(500 - Number(await control.hget('graphql:quota:stalled', 'tokens'))).toBe(committed);
      await adapter.dispose();
      await expect.poll(() => bridge.sockets).toBe(0);
    } finally {
      control.disconnect();
      await adapter.dispose();
      await bridge.close();
    }
  });
});

it('composes independent outage budgets with HTTP quota responses and active-work rejection', async () => {
  const bridge = await proxy();
  const replicas = await Promise.all(
    [0, 1].map(async () => {
      const runtime = ManagedRuntime.make(
        admissionLayer({
          enabled: true,
          limit: 1000,
          windowMs: 60000000,
          fallback: { capacity: 100, refillMs: 60000000, maxVisitors: 10 },
        }).pipe(
          Layer.provide(admissionTelemetryLayer),
          Layer.provide(
            redisQuotaLayer({ redisEnabled: true, redisHost: '127.0.0.1', redisPort: bridge.port })
          )
        )
      );
      const admission = await runtime.runPromise(Admission);
      return { runtime, admission };
    })
  );
  const release = Deferred.makeUnsafe<void>();
  let entered = false;
  class SlowCatalogue extends EmptyCatalogue {
    override search() {
      return Effect.sync(() => {
        entered = true;
      }).pipe(Effect.andThen(Deferred.await(release)), Effect.andThen(super.search()));
    }
  }
  const [a, b] = replicas;
  if (!a || !b) throw new Error('Expected two replicas');
  const apps = await Promise.all(
    replicas.map(({ admission }) =>
      createTestHttpApp(
        { ...httpConfig, quotaCapacity: 1000, graphqlMaxActive: 1 },
        { admission, catalogue: new SlowCatalogue() }
      )
    )
  );
  const [first, second] = apps;
  if (!first || !second) throw new Error('Expected two HTTP adapters');
  const invalid = (app: typeof first) =>
    app.inject({ method: 'POST', url: '/graphql', payload: { query: 'invalid' } });
  try {
    bridge.disconnect();
    await expect
      .poll(() => Effect.runPromise(a.admission.admit('probe', { _tag: 'Valid', cost: 0 })))
      .toMatchObject({ limit: 100 });
    await expect
      .poll(() => Effect.runPromise(b.admission.admit('probe', { _tag: 'Valid', cost: 0 })))
      .toMatchObject({ limit: 100 });
    const admitted = await invalid(first);
    expect(admitted.statusCode).toBe(400);
    expect(admitted.headers['x-ratelimit-cost-limit']).toBe('100');
    const limited = await invalid(first);
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({
      errors: [{ extensions: { code: 'RATE_LIMIT_EXCEEDED' } }],
    });
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect((await invalid(second)).statusCode).toBe(400);
    const pending = first.inject({
      method: 'POST',
      url: '/graphql',
      remoteAddress: '192.0.2.10',
      payload: { query: '{ searchWallpapers(first: 1) { edges { node { wallpaperId } } } }' },
    });
    // Start injection before polling the controlled backend.
    const response = pending.then((value) => value);
    await expect.poll(() => entered).toBe(true);
    expect((await invalid(first)).statusCode).toBe(503);
    await Effect.runPromise(Deferred.succeed(release, undefined));
    expect((await response).statusCode).toBe(200);
    bridge.restore();
    await expect
      .poll(() => Effect.runPromise(a.admission.admit('probe', { _tag: 'Valid', cost: 0 })), {
        timeout: 5000,
      })
      .not.toMatchObject({ limit: 100 });
    // The first shared reservation for this HTTP identity can spend the full shared budget.
    expect((await invalid(first)).statusCode).toBe(400);
  } finally {
    await Effect.runPromise(Deferred.succeed(release, undefined));
    await Promise.all(apps.map((app) => app.close()));
    await Promise.all(replicas.map(({ runtime }) => runtime.dispose()));
    await bridge.close();
  }
});
