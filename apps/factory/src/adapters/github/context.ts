import { AsyncLocalStorage } from 'node:async_hooks';
import { Context, Effect } from 'effect';
import type { Unavailable } from '../../capabilities/job/index.js';

// Promise-based Git orchestration must retain the caller's tracer, parent span
// and logger when it re-enters an Effect service. Each async operation is isolated.
const execution = new AsyncLocalStorage<Context.Context<never>>();
export function contextualPromise<A>(options: {
  try: (signal: AbortSignal) => Promise<A>;
  catch: (cause: unknown) => Unavailable;
}): Effect.Effect<A, Unavailable> {
  return Effect.contextWith((context) =>
    Effect.tryPromise({
      try: (signal) => execution.run(context, () => options.try(signal)),
      catch: options.catch,
    })
  );
}
export function runInContext<A, E>(effect: Effect.Effect<A, E>, signal?: AbortSignal): Promise<A> {
  return Effect.runPromiseWith(execution.getStore() ?? Context.empty())(effect, { signal });
}
