import { Context, Deferred, Effect, Fiber, Layer } from 'effect';

export interface Worker {
  readonly name: string;
  readonly intervalMs: number;
  /** false reports an unsuccessful batch without losing progress on other items. */
  readonly run: (isStopping: () => boolean) => Effect.Effect<boolean, unknown>;
}
export interface Workers {
  check(): Effect.Effect<boolean>;
}
export const Workers = Context.Service<Workers>('wallpaperdb.user.composition.Workers');

export const workerLayer = (workers: readonly Worker[], shutdownTimeoutMs = 5000) =>
  Layer.effect(
    Workers,
    Effect.gen(function* () {
      const health = new Map<string, boolean>();
      const stop = yield* Deferred.make<void>();
      let stopping = false;
      const start = Effect.forEach(workers, (worker) => {
        health.set(worker.name, true);
        const loop = Effect.gen(function* () {
          while (!stopping) {
            const healthy = yield* worker
              .run(() => stopping)
              .pipe(Effect.catch(() => Effect.succeed(false)));
            health.set(worker.name, healthy);
            if (!healthy)
              yield* Effect.logWarning('Profile maintenance batch failed', { worker: worker.name });
            if (!stopping)
              yield* Effect.raceFirst(Effect.sleep(worker.intervalMs), Deferred.await(stop));
          }
        }).pipe(Effect.onExit(() => Effect.sync(() => health.set(worker.name, false))));
        return Effect.forkScoped(loop);
      });
      yield* Effect.acquireRelease(start, (fibers) =>
        Effect.gen(function* () {
          stopping = true;
          yield* Deferred.succeed(stop, undefined);
          yield* Fiber.awaitAll(fibers).pipe(
            Effect.interruptible,
            Effect.timeoutOrElse({
              duration: shutdownTimeoutMs,
              orElse: () => Fiber.interruptAll(fibers),
            })
          );
        })
      );
      return Workers.of({ check: () => Effect.sync(() => [...health.values()].every(Boolean)) });
    })
  );
