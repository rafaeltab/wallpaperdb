import { AsyncLocalStorage } from 'node:async_hooks';
import { Context, Effect } from 'effect';
import type { RecoveryAdmission, Unavailable } from '../../capabilities/job/index.js';

// Promise-based Git orchestration must retain the caller's tracer, parent span
// and logger when it re-enters an Effect service. Each async operation is isolated.
const execution = new AsyncLocalStorage<Context.Context<never>>();
const admission = new AsyncLocalStorage<RecoveryAdmission>();
export function contextualPromise<A>(options: {
  admitRecovery?: RecoveryAdmission;
  defaultRecoveryAdmission?: RecoveryAdmission;
  try: (signal: AbortSignal) => Promise<A>;
  catch: (cause: unknown) => Unavailable;
}): Effect.Effect<A, Unavailable> {
  return Effect.contextWith((context) =>
    Effect.tryPromise({
      try: (signal) =>
        execution.run(context, () =>
          admission.run(
            options.admitRecovery ??
              admission.getStore() ??
              options.defaultRecoveryAdmission ??
              (() => Effect.succeed(true)),
            () => options.try(signal)
          )
        ),
      catch: options.catch,
    })
  );
}
export function runInContext<A, E>(effect: Effect.Effect<A, E>, signal?: AbortSignal): Promise<A> {
  return Effect.runPromiseWith(execution.getStore() ?? Context.empty())(effect, { signal });
}

export function admitRecovery(issue: number, signal?: AbortSignal) {
  return runInContext(admission.getStore()?.(issue) ?? Effect.succeed(true), signal);
}
