import { Effect, Layer, ManagedRuntime, Metric } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';
import { Availability, type DependencyHealth } from '../src/capabilities/availability/index.js';
import { monitorLayer } from '../src/monitor.js';

const value = (dependency: string, required = 'true') =>
  Metric.snapshot.pipe(
    Effect.map((snapshots) => {
      const metric = snapshots.find(
        (metric) =>
          metric.id === 'asset.dependency.healthy' &&
          metric.attributes?.dependency === dependency &&
          metric.attributes?.required === required
      );
      return metric?.type === 'Gauge' ? metric.state.value : undefined;
    })
  );
const observedAt = Metric.snapshot.pipe(
  Effect.map((snapshots) => {
    const metric = snapshots.find((metric) => metric.id === 'asset.dependency.observed_at_seconds');
    return metric?.type === 'Gauge' ? metric.state.value : undefined;
  })
);

function monitor(health: Availability['health'], telemetryEnabled = true) {
  return ManagedRuntime.make(
    monitorLayer({ telemetryEnabled }).pipe(
      Layer.provide(
        Layer.succeed(Availability, {
          health,
          ready: () => Effect.die('Unexpected readiness probe'),
        })
      ),
      Layer.provideMerge(TestClock.layer()),
      Layer.provideMerge(Layer.succeed(Metric.MetricRegistry, new Map()))
    )
  );
}

describe('Dependency monitoring', () => {
  it('reports dependency failure and recovery without needing HTTP health requests', async () => {
    let checks: DependencyHealth = {
      s3: true,
      identity: true,
      database: true,
      nats: true,
      consumer: true,
      otel: true,
    };
    const runtime = monitor((shuttingDown) => {
      expect(shuttingDown).toBe(false);
      return Effect.sync(() => ({
        status: 'healthy',
        checks,
        timestamp: '2030-01-01T00:00:00Z',
        totalDurationMs: 0,
      }));
    });
    try {
      await expect.poll(() => runtime.runPromise(value('database'))).toBe(1);
      checks = {
        s3: true,
        identity: false,
        database: false,
        nats: true,
        consumer: false,
        otel: true,
      };
      await runtime.runPromise(TestClock.adjust('30 seconds'));
      expect(await runtime.runPromise(value('database'))).toBe(0);
      expect(await runtime.runPromise(value('identity'))).toBe(0);
      expect(await runtime.runPromise(value('consumer'))).toBe(0);
      expect(await runtime.runPromise(value('nats'))).toBe(1);
      expect(await runtime.runPromise(observedAt)).toBe(30);
      checks = { s3: true, identity: true, database: true, nats: true, consumer: true, otel: true };
      await runtime.runPromise(TestClock.adjust('30 seconds'));
      expect(await runtime.runPromise(value('database'))).toBe(1);
      expect(await runtime.runPromise(value('consumer'))).toBe(1);
    } finally {
      await runtime.dispose();
    }
  });
  it('bounds a hung probe, retries sequentially, and interrupts it when its scope closes', async () => {
    let starts = 0;
    let interruptions = 0;
    const runtime = monitor(() =>
      Effect.sync(() => {
        starts++;
      }).pipe(
        Effect.andThen(Effect.never),
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            interruptions++;
          })
        )
      )
    );
    try {
      await runtime.runPromise(Effect.void);
      await expect.poll(() => starts).toBe(1);
      await runtime.runPromise(TestClock.adjust('20 seconds'));
      expect(interruptions).toBe(1);
      expect(await runtime.runPromise(value('database'))).toBe(0);
      expect(await runtime.runPromise(value('consumer'))).toBe(0);
      expect(await runtime.runPromise(observedAt)).toBe(20);
      await runtime.runPromise(TestClock.adjust('30 seconds'));
      expect(starts).toBe(2);
      const context = await runtime.context();
      await runtime.dispose();
      expect(interruptions).toBe(2);
      await Effect.runPromise(TestClock.adjust('2 minutes').pipe(Effect.provide(context)));
      expect(starts).toBe(2);
    } finally {
      await runtime.dispose();
    }
  });

  it('marks intentionally disabled telemetry optional while continuing to check protective consumer', async () => {
    const runtime = monitor(
      () =>
        Effect.succeed({
          status: 'degraded',
          timestamp: '',
          totalDurationMs: 0,
          checks: {
            s3: true,
            database: true,
            nats: true,
            consumer: false,
            otel: false,
          },
        }),
      false
    );
    try {
      await expect.poll(() => runtime.runPromise(value('otel', 'false'))).toBe(1);
      expect(await runtime.runPromise(value('otel'))).toBeUndefined();
      expect(await runtime.runPromise(value('consumer'))).toBe(0);
    } finally {
      await runtime.dispose();
    }
  });
});
