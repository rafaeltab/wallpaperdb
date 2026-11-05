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

it('returns a conflict without inventing a resource when a competing accepted attempt already finished', async () => {
  const store = { ...controlledAttemptStore(), create: () => Effect.succeed(false) };
  const runtime = ManagedRuntime.make(
    AttemptsLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(AttemptStore, store),
          Layer.succeed(IPlanner, {
            ownership: () => Effect.succeed(undefined),
            propose: () => Effect.die('No launch'),
          }),
          Layer.succeed(Plan, { preview: () => Effect.die('No preview') }),
          Layer.succeed(Time, { now: () => Effect.succeed(1000) })
        )
      )
    )
  );
  try {
    const attempts = await runtime.runPromise(Attempts);
    expect(await runtime.runPromise(attempts.submit('never-persisted'))).toEqual({
      kind: 'conflict',
    });
  } finally {
    await runtime.dispose();
  }
});

it('keeps an unfinished attempt observable until freshness/result persist even when its bound proposal succeeded', async () => {
  const store = controlledAttemptStore();
  await Effect.runPromise(
    store.create({
      id: 'pending-result',
      revision: 0,
      startedAt: 1000,
      deadline: 121000,
      phase: 'discovery',
    })
  );
  const runtime = ManagedRuntime.make(
    AttemptsLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(AttemptStore, store),
          Layer.succeed(IPlanner, {
            ownership: () =>
              Effect.succeed({
                requestId: 'pending-result',
                revision: 3,
                deadline: 121000,
                retired: true,
                phase: 'succeeded' as const,
                run: { threadId: 'thread', runId: 'run' },
              }),
            propose: () => Effect.die('No launch'),
          }),
          Layer.succeed(Plan, { preview: () => Effect.die('No preview') }),
          Layer.succeed(Time, { now: () => Effect.succeed(2000) })
        )
      )
    )
  );
  try {
    const attempts = await runtime.runPromise(Attempts);
    expect(await runtime.runPromise(attempts.observe('pending-result'))).toMatchObject({
      phase: 'discovery',
      elapsedMs: 1000,
      launch: { phase: 'succeeded' },
    });
    expect(await runtime.runPromise(attempts.observe('pending-result'))).not.toHaveProperty(
      'result'
    );
  } finally {
    await runtime.dispose();
  }
});

it.each([
  {
    name: 'discovery with only an unrelated retired legacy claim',
    phase: 'discovery' as const,
    ownership: { requestId: 'legacy', revision: 1, deadline: 0, retired: true },
    detail:
      'Overall planning deadline exceeded during discovery before planner launch. No planner launch was recorded for this attempt; no launch reconciliation is required.',
  },
  {
    name: 'a matching outstanding bound advisory run',
    phase: 'discovery' as const,
    ownership: {
      requestId: 'attempt',
      revision: 2,
      deadline: 121000,
      run: { threadId: 'thread', runId: 'run' },
      phase: 'running' as const,
    },
    detail:
      'Overall planning deadline exceeded. This attempt has a bound advisory run whose launch ownership remains outstanding; observe the run before retrying.',
  },
  {
    name: 'a matching unbound uncertain launch',
    phase: 'discovery' as const,
    ownership: { requestId: 'attempt', revision: 1, deadline: 121000, phase: 'uncertain' as const },
    detail:
      'Overall planning deadline exceeded after launch intent. This attempt has an uncertain launch outcome; operator reconciliation is required before retrying.',
  },
  {
    name: 'freshness after a retired advisory run',
    phase: 'freshness' as const,
    ownership: {
      requestId: 'attempt',
      revision: 3,
      deadline: 121000,
      retired: true,
      phase: 'succeeded' as const,
      run: { threadId: 'thread', runId: 'run' },
    },
    detail:
      'Overall planning deadline exceeded during freshness validation. The advisory proposal is not validated; no implementation was dispatched.',
  },
  {
    name: 'restart discovery after a retired advisory run',
    phase: 'discovery' as const,
    ownership: {
      requestId: 'attempt',
      revision: 3,
      deadline: 121000,
      retired: true,
      phase: 'succeeded' as const,
      run: { threadId: 'thread', runId: 'run' },
    },
    detail:
      'Overall planning deadline exceeded after the advisory run. Its launch ownership is retired; no validated preview is available.',
  },
  {
    name: 'a matching retired non-launch claim',
    phase: 'discovery' as const,
    ownership: {
      requestId: 'attempt',
      revision: 2,
      deadline: 121000,
      retired: true,
      phase: 'failed' as const,
    },
    detail:
      "Overall planning deadline exceeded before a planner run was bound. This attempt's launch ownership is retired; no launch reconciliation is required.",
  },
])('reports a truthful deadline outcome for $name', async ({ phase, ownership, detail }) => {
  const store = controlledAttemptStore();
  const original = {
    id: 'attempt',
    revision: 0,
    startedAt: 1000,
    deadline: 121000,
    phase: 'discovery' as const,
  };
  await Effect.runPromise(store.create(original));
  if (phase === 'freshness')
    await Effect.runPromise(store.save({ ...original, revision: 1, phase }));
  const runtime = ManagedRuntime.make(
    AttemptsLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(AttemptStore, store),
          Layer.succeed(IPlanner, {
            ownership: () => Effect.succeed(ownership),
            propose: () => Effect.die('Expired attempt must not launch'),
          }),
          Layer.succeed(Plan, {
            preview: () => Effect.die('Expired attempt must not restart planning'),
          }),
          Layer.succeed(Time, { now: () => Effect.succeed(121009) })
        )
      )
    )
  );
  try {
    const attempts = await runtime.runPromise(Attempts);
    await runtime.runPromise(attempts.execute('attempt'));
    expect(await Effect.runPromise(store.get('attempt'))).toMatchObject({
      id: original.id,
      startedAt: original.startedAt,
      deadline: original.deadline,
      finishedAt: 121009,
      phase: 'failed',
      detail,
    });
  } finally {
    await runtime.dispose();
  }
});
