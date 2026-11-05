import { Effect, Layer, ManagedRuntime } from 'effect';
import { expect, it } from 'vitest';
import {
  Attempts,
  AttemptsLive,
  AttemptStore,
  Plan,
  PlanLive,
  PlanningSource,
  IPlanner,
  type PlanningInput,
  type PlannerOwnership,
} from '../src/capabilities/plan/index.js';
import { Time } from '../src/capabilities/job/index.js';
import { controlledAttemptStore } from './fixtures/attempt-store.js';
const input: PlanningInput = {
  issues: [],
  job: { kind: 'empty' },
  capacity: { concurrency: 1, admission: 1 },
};
it.each(['discovery', 'freshness'] as const)(
  'bounds %s by the persisted overall deadline and cancels underlying work',
  async (phase) => {
    const store = controlledAttemptStore();
    const now = Date.now();
    await Effect.runPromise(
      store.create({
        id: 'attempt',
        revision: 0,
        startedAt: now - 100,
        deadline: now + 60,
        phase: 'discovery',
      })
    );
    let reads = 0;
    let cancelled = false;
    const source = Layer.succeed(PlanningSource, {
      read: () =>
        Effect.suspend(() => {
          reads++;
          if (phase === 'discovery' || reads === 2)
            return Effect.never.pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  cancelled = true;
                })
              )
            );
          return Effect.succeed(input);
        }),
    });
    const planner = Layer.succeed(IPlanner, {
      ownership: () => Effect.succeed(undefined),
      propose: () => Effect.succeed({ selected: [], deferred: [] }),
    });
    const plan = PlanLive.pipe(Layer.provide(Layer.mergeAll(source, planner)));
    const runtime = ManagedRuntime.make(
      AttemptsLive.pipe(
        Layer.provide(
          Layer.mergeAll(
            plan,
            planner,
            Layer.succeed(AttemptStore, store),
            Layer.succeed(Time, { now: () => Effect.succeed(now) })
          )
        )
      )
    );
    try {
      const attempts = await runtime.runPromise(Attempts);
      await runtime.runPromise(attempts.execute('attempt'));
      expect(cancelled).toBe(true);
      expect(await Effect.runPromise(store.get('attempt'))).toMatchObject({
        phase: 'failed',
        deadline: now + 60,
        detail: expect.stringContaining('deadline'),
      });
    } finally {
      await runtime.dispose();
    }
  }
);

it('distinguishes busy ownership, allows late bound completion, and never retries an unbound uncertain launch', async () => {
  const store = controlledAttemptStore();
  let ownership: PlannerOwnership | undefined = {
    requestId: 'old',
    revision: 1,
    deadline: 0,
    run: { threadId: 'thread', runId: 'run' },
    phase: 'running',
  };
  let observed = 0;
  const planner = {
    ownership: () =>
      Effect.sync(() => {
        observed++;
        return ownership;
      }),
    propose: () => Effect.die('No worker dispatch from submission'),
  };
  const runtime = ManagedRuntime.make(
    AttemptsLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(AttemptStore, store),
          Layer.succeed(IPlanner, planner),
          Layer.succeed(Plan, { preview: () => Effect.die('No synchronous preview') }),
          Layer.succeed(Time, { now: () => Effect.sync(Date.now) })
        )
      )
    )
  );
  try {
    const attempts = await runtime.runPromise(Attempts);
    expect(await runtime.runPromise(attempts.submit('new'))).toEqual({
      kind: 'blocked',
      requestId: 'old',
      reason: 'outstanding',
    });
    ownership = { ...ownership, run: undefined, phase: 'uncertain' };
    expect(await runtime.runPromise(attempts.submit('new'))).toEqual({
      kind: 'blocked',
      requestId: 'old',
      reason: 'reconciliation-required',
    });
    ownership = { ...ownership, retired: true, phase: 'succeeded' };
    expect(await runtime.runPromise(attempts.submit('new'))).toEqual({
      kind: 'accepted',
      id: 'new',
    });
    expect(observed).toBe(3);
    expect(await runtime.runPromise(attempts.submit('other'))).toEqual({ kind: 'busy', id: 'new' });
    expect(observed).toBe(3);
  } finally {
    await runtime.dispose();
  }
});

it('controlled attempt storage satisfies the shared application contract', async () => {
  const { attemptStoreContract } = await import('./fixtures/attempt-store-contract.js');
  await attemptStoreContract(controlledAttemptStore());
});
