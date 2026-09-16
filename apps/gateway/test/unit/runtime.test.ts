import { Deferred, Effect, Layer, ManagedRuntime } from 'effect';
import { describe, expect, it } from 'vitest';
import { Admission } from '../../src/admission/index.js';
import { Availability } from '../../src/availability/index.js';
import { Catalogue } from '../../src/catalogue/index.js';
import { HttpExecution, httpExecutionLayer } from '../../src/runtime.js';
import { EmptyCatalogue } from './http-fixture.js';

const services = Layer.mergeAll(
  Layer.succeed(Catalogue, new EmptyCatalogue()),
  Layer.succeed(Admission, {
    admit: () => Effect.succeed({ _tag: 'Allowed', remaining: 1, reset: 1 }),
  }),
  Layer.succeed(Availability, {
    health: () => Effect.die('unused'),
    ready: () => Effect.die('unused'),
  })
);

describe('HTTP execution ownership', () => {
  it('interrupts an in-flight request and runs its finalizer when its runtime closes', async () => {
    const runtime = ManagedRuntime.make(httpExecutionLayer.pipe(Layer.provide(services)));
    const execution = await runtime.runPromise(HttpExecution);
    const started = Deferred.makeUnsafe<void>();
    let released = false;
    const result = execution.run(
      Deferred.succeed(started, undefined).pipe(
        Effect.andThen(Effect.never),
        Effect.ensuring(
          Effect.sync(() => {
            released = true;
          })
        )
      )
    );
    const rejected = expect(result).rejects.toThrow();
    await Effect.runPromise(Deferred.await(started));
    await runtime.dispose();
    await rejected;
    expect(released).toBe(true);
  });

  it('cancels abandoned requests without disposing services used by other requests', async () => {
    const runtime = ManagedRuntime.make(httpExecutionLayer.pipe(Layer.provide(services)));
    try {
      const execution = await runtime.runPromise(HttpExecution);
      const controller = new AbortController();
      let cancelled = false;
      const pending = execution.run(
        Effect.never.pipe(
          Effect.ensuring(
            Effect.sync(() => {
              cancelled = true;
            })
          )
        ),
        { signal: controller.signal }
      );
      const rejected = expect(pending).rejects.toThrow();
      controller.abort();
      await rejected;
      expect(cancelled).toBe(true);
      expect(await execution.run(Admission.use((admission) => admission.admit('a')))).toMatchObject(
        { _tag: 'Allowed' }
      );
    } finally {
      await runtime.dispose();
    }
  });
});
