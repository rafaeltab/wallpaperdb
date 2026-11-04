import { AsyncLocalStorage } from 'node:async_hooks';
import { Context, Effect } from 'effect';
import type { RecoveryAdmission, Unavailable } from '../../capabilities/job/index.js';

// Promise-based Git orchestration must retain the caller's tracer, parent span
// and logger when it re-enters an Effect service. Each async operation is isolated.
const execution = new AsyncLocalStorage<Context.Context<never>>();
// An observation without a policy must not mint an inherited manual grant.
// The legacy manual fallback applies only at the actual recovery boundary.
const admission = new AsyncLocalStorage<RecoveryAdmission | undefined>();
export function contextualPromise<A>(options: {
  admitRecovery?: RecoveryAdmission;
  defaultRecoveryAdmission?: RecoveryAdmission;
  try: (signal: AbortSignal) => Promise<A>;
  catch: (cause: unknown) => Unavailable;
}): Effect.Effect<A, Unavailable> {
  return Effect.contextWith((context) =>
    Effect.callback<A, Unavailable>((resume, signal) => {
      const pending = Promise.resolve().then(() =>
        execution.run(context, () =>
          admission.run(
            options.admitRecovery ?? admission.getStore() ?? options.defaultRecoveryAdmission,
            () => options.try(signal)
          )
        )
      );
      const settled = pending.then(
        (value) => resume(Effect.succeed(value)),
        (cause) => resume(Effect.fail(options.catch(cause)))
      );
      // Abort is cooperative: native filesystem work may still be settling.
      // Keep ownership until the underlying operation has actually finished.
      return Effect.promise(() => settled);
    })
  );
}
export function runInContext<A, E>(effect: Effect.Effect<A, E>, signal?: AbortSignal): Promise<A> {
  return Effect.runPromiseWith(execution.getStore() ?? Context.empty())(effect, { signal });
}

export function admitRecovery(issue: number, signal?: AbortSignal) {
  return runInContext(admission.getStore()?.(issue) ?? Effect.succeed(true), signal);
}
