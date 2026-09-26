import { Effect, Layer, ManagedRuntime } from 'effect';
import { expect, it } from 'vitest';
import { Maintenance, MaintenanceFailure, MaintenanceStore, ProfileEvents, maintenanceLayer } from '../src/maintenance/index.js';

it('records publication only after broker acceptance and retries the original durable event', async () => {
  const pending = new Set(['event-1', 'event-2']);
  const attempted: string[] = [];
  let unavailable = true;
  const runtime = ManagedRuntime.make(maintenanceLayer.pipe(Layer.provide(Layer.mergeAll(
    Layer.succeed(MaintenanceStore, {
      pendingEvents: () => Effect.succeed([...pending].map((id) => ({ id, createdAt: new Date(0) }))),
      markPublished: (id) => Effect.sync(() => { pending.delete(id); }),
    }),
    Layer.succeed(ProfileEvents, {
      publish: (id) => Effect.suspend(() => {
        attempted.push(id);
        return id === 'event-1' && unavailable
          ? Effect.fail(new MaintenanceFailure({ operation: 'publish', cause: 'offline' }))
          : Effect.void;
      }),
    }),
  ))));
  try {
    expect(await runtime.runPromise(Effect.flatMap(Maintenance, (service) => service.publishPending()))).toEqual({ completed: 1, failed: 1 });
    expect([...pending]).toEqual(['event-1']);
    unavailable = false;
    expect(await runtime.runPromise(Effect.flatMap(Maintenance, (service) => service.publishPending()))).toEqual({ completed: 1, failed: 0 });
    expect(attempted).toEqual(['event-1', 'event-2', 'event-1']);
    expect([...pending]).toEqual([]);
  } finally { await runtime.dispose(); }
});
