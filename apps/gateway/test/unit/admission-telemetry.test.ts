import { metrics } from '@opentelemetry/api';
import {
  InMemoryMetricExporter,
  AggregationTemporality,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { expect, it } from 'vitest';
import {
  admissionTelemetryLayer,
  quotaUsageTelemetryLayer,
} from '../../src/adapters/admission-telemetry/index.js';
import {
  Admission,
  admissionLayer,
  Quota,
  QuotaUnavailable,
  QuotaUsage,
  type QuotaUsageSnapshot,
} from '../../src/capabilities/admission/index.js';
import { memoryQuotaLayer } from '../helpers/quota.js';

function observe() {
  const reader = new PeriodicExportingMetricReader({
    exporter: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
    exportIntervalMillis: 60000,
  });
  const provider = new MeterProvider({ readers: [reader] });
  metrics.setGlobalMeterProvider(provider);
  return {
    async read() {
      const { resourceMetrics } = await reader.collect();
      return resourceMetrics.scopeMetrics.flatMap((scope) =>
        scope.metrics.flatMap((metric) =>
          metric.dataPoints.map((point) => ({
            name: metric.descriptor.name,
            value: point.value,
            attributes: point.attributes,
          }))
        )
      );
    },
    async close() {
      metrics.disable();
      await provider.shutdown();
    },
  };
}

it('exports charged points and denials through the admission telemetry mechanism without identities', async () => {
  const observed = observe();
  let unavailable = false;
  const shared = await Effect.runPromise(Quota.pipe(Effect.provide(memoryQuotaLayer)));
  const runtime = ManagedRuntime.make(
    admissionLayer({
      enabled: true,
      limit: 300,
      windowMs: 60000000,
      fallback: { capacity: 100, refillMs: 60000000, maxVisitors: 10 },
    }).pipe(
      Layer.provide(
        Layer.merge(
          admissionTelemetryLayer,
          Layer.succeed(Quota, {
            take: (...args) =>
              unavailable
                ? Effect.fail(new QuotaUnavailable({ reason: 'unavailable' }))
                : shared.take(...args),
          })
        )
      )
    )
  );
  try {
    const admission = await runtime.runPromise(Admission);
    await Effect.runPromise(admission.admit('private-identity', { _tag: 'Valid', cost: 300 }));
    await Effect.runPromise(admission.admit('private-identity', { _tag: 'Valid', cost: 100 }));
    unavailable = true;
    await Effect.runPromise(admission.admit('private-identity', { _tag: 'Rejected' }));
    await Effect.runPromise(admission.admit('private-identity', { _tag: 'Rejected' }));
    const points = await observed.read();
    expect(points).toEqual(
      expect.arrayContaining([
        { name: 'admission.cost.charged', value: 300, attributes: { mode: 'shared' } },
        { name: 'admission.cost.charged', value: 100, attributes: { mode: 'local' } },
        { name: 'admission.quota.denied', value: 1, attributes: { mode: 'shared' } },
        { name: 'admission.quota.denied', value: 1, attributes: { mode: 'local' } },
      ])
    );
    expect(JSON.stringify(points)).not.toContain('private-identity');
  } finally {
    await runtime.dispose();
    await observed.close();
  }
});

it('collects current shared usage while idle, hides unavailable values and unregisters on shutdown', async () => {
  const observed = observe();
  let reads = 0;
  let snapshot: QuotaUsageSnapshot = {
    _tag: 'Available',
    minute: 120,
    sampledAt: 135,
    points: 1000,
    activeIps: 2,
  };
  const runtime = ManagedRuntime.make(
    quotaUsageTelemetryLayer.pipe(
      Layer.provide(
        Layer.succeed(QuotaUsage, {
          read: () =>
            Effect.sync(() => {
              reads += 1;
              return snapshot;
            }),
        })
      )
    )
  );
  try {
    await runtime.runPromise(Effect.void);
    expect(await observed.read()).toEqual(
      expect.arrayContaining([
        { name: 'admission.usage.points', value: 1000, attributes: {} },
        { name: 'admission.usage.active_ips', value: 2, attributes: {} },
        { name: 'admission.usage.minute', value: 120, attributes: {} },
        { name: 'admission.usage.sampled_at', value: 135, attributes: {} },
        { name: 'admission.usage.available', value: 1, attributes: {} },
      ])
    );
    snapshot = { _tag: 'Unavailable' };
    expect(await observed.read()).toEqual([
      { name: 'admission.usage.available', value: 0, attributes: {} },
      { name: 'admission.usage.points', value: Number.NaN, attributes: {} },
      { name: 'admission.usage.active_ips', value: Number.NaN, attributes: {} },
      { name: 'admission.usage.minute', value: 0, attributes: {} },
      { name: 'admission.usage.sampled_at', value: 0, attributes: {} },
    ]);
    snapshot = { _tag: 'Available', minute: 180, sampledAt: 185, points: 0, activeIps: 0 };
    expect(await observed.read()).toContainEqual({
      name: 'admission.usage.minute',
      value: 180,
      attributes: {},
    });
    await runtime.dispose();
    const before = reads;
    await observed.read();
    expect(reads).toBe(before);
  } finally {
    await runtime.dispose();
    await observed.close();
  }
});
