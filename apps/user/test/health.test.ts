import { Effect, Layer, ManagedRuntime } from 'effect';
import { describe, expect, it } from 'vitest';
import { Availability, AvailabilityProbe, availabilityLayer } from '../src/availability/index.js';

describe('User availability', () => {
  it('reports partial dependency failure and does not probe during shutdown', async () => {
    let probes = 0;
    const runtime = ManagedRuntime.make(availabilityLayer.pipe(Layer.provide(Layer.succeed(AvailabilityProbe, {
      inspect: () => Effect.sync(() => {
        probes++;
        return { database: true, nats: false, otel: true, workers: true };
      }),
    }))));
    try {
      expect(await runtime.runPromise(Availability.use((service) => service.health(false)))).toMatchObject({
        status: 'degraded', checks: { database: true, nats: false, otel: true, workers: true },
      });
      expect(await runtime.runPromise(Availability.use((service) => service.health(true)))).toMatchObject({
        status: 'shutting_down', checks: {},
      });
      expect(probes).toBe(1);
    } finally { await runtime.dispose(); }
  });
});
