import { Effect, Layer, ManagedRuntime, Metric } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';
import { Availability, type DependencyHealth } from '../src/availability/index.js';
import { monitorLayer } from '../src/monitor.js';

const value = (dependency: string, required = 'true') =>
  Metric.snapshot.pipe(
    Effect.map((snapshots) => {
      const metric = snapshots.find(
        (metric) =>
          metric.id === 'user.dependency.healthy' &&
          metric.attributes?.dependency === dependency &&
          metric.attributes?.required === required
      );
      return metric?.type === 'Gauge' ? metric.state.value : undefined;
    })
  );
const observedAt = Metric.snapshot.pipe(
  Effect.map((snapshots) => {
    const metric = snapshots.find((metric) => metric.id === 'user.dependency.observed_at_seconds');
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
    let checks: DependencyHealth = { database: true, nats: true, workers: true, otel: true };
    const runtime = monitor((shuttingDown) => {
      expect(shuttingDown).toBe(false);
      return Effect.sync(() => ({ status: 'healthy', checks, timestamp: '2030-01-01T00:00:00Z' }));
    });
    try {
      await expect.poll(() => runtime.runPromise(value('database'))).toBe(1);
      checks = { database: false, nats: true, workers: false, otel: true };
      await runtime.runPromise(TestClock.adjust('30 seconds'));
      expect(await runtime.runPromise(value('database'))).toBe(0);
      expect(await runtime.runPromise(value('workers'))).toBe(0);
      expect(await runtime.runPromise(value('nats'))).toBe(1);
      expect(await runtime.runPromise(observedAt)).toBe(30);
      checks = { database: true, nats: true, workers: true, otel: true };
      await runtime.runPromise(TestClock.adjust('30 seconds'));
      expect(await runtime.runPromise(value('database'))).toBe(1);
      expect(await runtime.runPromise(value('workers'))).toBe(1);
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
      expect(await runtime.runPromise(value('workers'))).toBe(0);
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

  it('marks intentionally disabled telemetry optional while continuing to check protective workers', async () => {
    const runtime = monitor(
      () =>
        Effect.succeed({
          status: 'degraded',
          timestamp: '',
          checks: {
            database: true,
            nats: true,
            workers: false,
            otel: false,
          },
        }),
      false
    );
    try {
      await expect.poll(() => runtime.runPromise(value('otel', 'false'))).toBe(1);
      expect(await runtime.runPromise(value('otel'))).toBeUndefined();
      expect(await runtime.runPromise(value('workers'))).toBe(0);
    } finally {
      await runtime.dispose();
    }
  });
});
