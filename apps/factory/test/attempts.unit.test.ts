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
import { Time, Unavailable } from '../src/capabilities/job/index.js';
import { controlledAttemptStore } from './fixtures/attempt-store.js';
const input: PlanningInput = {
  issues: [],
  job: { kind: 'empty' },
  capacity: { concurrency: 1, admission: 1 },
};
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
    const fresh = await Effect.runPromise(store.get('new'));
    expect(fresh?.deadline).toBe(0);
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
      'Model deadline exceeded. No validated proposal is available; no implementation was dispatched.',
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
      'Model deadline exceeded. The bound advisory run remains outstanding; observe it before retrying.',
  },
  {
    name: 'a matching unbound uncertain launch',
    phase: 'discovery' as const,
    ownership: { requestId: 'attempt', revision: 1, deadline: 121000, phase: 'uncertain' as const },
    detail:
      'Model deadline exceeded after launch intent. Operator reconciliation is required before retrying the uncertain launch.',
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
      'Model deadline exceeded. No validated proposal is available; no implementation was dispatched.',
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
      'Model deadline exceeded. No validated proposal is available; no implementation was dispatched.',
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
      'Model deadline exceeded. No validated proposal is available; no implementation was dispatched.',
  },
])(
  'reports a model deadline failure based on ownership for $name',
  async ({ phase, ownership, detail }) => {
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
              preview: () =>
                Effect.fail(new Unavailable({ operation: 'model-deadline', cause: null })),
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
  }
);

it.each(['preview', 'stale'] as const)(
  'persists a completed %s through freshness with bounded presentation context and does not replay terminal work',
  async (kind) => {
    const store = controlledAttemptStore();
    const original = {
      id: 'successful-attempt',
      revision: 0,
      startedAt: 100,
      deadline: 120100,
      phase: 'discovery' as const,
    };
    await Effect.runPromise(store.create(original));
    const issue = {
      number: 42,
      url: 'https://github.com/rafaeltab/wallpaperdb/issues/42',
      title: 'Synthetic issue',
      body: 'Full requirements stay in planner context',
      author: 'rafaeltab',
      open: true,
      labels: ['ready-for-agent'],
      comments: [],
      blockers: [40],
      parents: [10],
      blockersReady: true,
      prerequisiteEvidence: 'Synthetic verified prerequisite',
      recovery: { progress: 'Parked', question: 'Which interface?' },
    };
    const selected =
      kind === 'preview'
        ? [{ issue: 42, reason: 'Thin experiment', includeCodeFromIssues: [] }]
        : [];
    const rejected = kind === 'stale' ? [{ issue: 0, reason: 'Inputs changed' }] : [];
    let calls = 0;
    const runtime = ManagedRuntime.make(
      AttemptsLive.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(AttemptStore, store),
            Layer.succeed(IPlanner, {
              ownership: () => Effect.succeed(undefined),
              propose: () => Effect.die('The Plan port already owns the proposal'),
            }),
            Layer.succeed(Plan, {
              preview: (attempt) =>
                Effect.gen(function* () {
                  if (!attempt) return yield* Effect.die('Missing attempt identity');
                  expect(attempt.requestId).toBe(original.id);
                  calls++;
                  yield* attempt.progress('freshness');
                  return { kind, selected, rejected, input: { ...input, issues: [issue] } };
                }),
            }),
            Layer.succeed(Time, { now: () => Effect.succeed(500) })
          )
        )
      )
    );
    try {
      const attempts = await runtime.runPromise(Attempts);
      await runtime.runPromise(attempts.execute(original.id));
      const expected = {
        kind,
        selected,
        rejected,
        input: {
          issues: [
            {
              number: 42,
              title: 'Synthetic issue',
              blockers: [40],
              parents: [10],
              recovery: { progress: 'Parked', question: 'Which interface?' },
            },
          ],
        },
      };
      expect(await runtime.runPromise(attempts.observe(original.id))).toMatchObject({
        id: original.id,
        phase: 'succeeded',
        startedAt: 100,
        deadline: null,
        finishedAt: 500,
        elapsedMs: 400,
        result: expected,
      });
      expect((await Effect.runPromise(store.get(original.id)))?.result).toEqual(expected);
      expect(await runtime.runPromise(attempts.pending())).toBeUndefined();
      expect(await runtime.runPromise(attempts.observe('missing'))).toBeUndefined();
      await runtime.runPromise(attempts.execute(original.id));
      await runtime.runPromise(attempts.execute('missing'));
      expect(calls).toBe(1);
    } finally {
      await runtime.dispose();
    }
  }
);

it.each([false, true])(
  'records a dependency failure without exposing its cause, with matching rejection detail=%s',
  async (knownRejection) => {
    const store = controlledAttemptStore();
    const original = {
      id: 'failed-attempt',
      revision: 0,
      startedAt: 100,
      deadline: 120100,
      phase: 'discovery' as const,
    };
    await Effect.runPromise(store.create(original));
    const safeDetail = 'T3 rejected launch with -32602. No worker started.';
    const runtime = ManagedRuntime.make(
      AttemptsLive.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(AttemptStore, store),
            Layer.succeed(IPlanner, {
              ownership: () =>
                Effect.succeed(
                  knownRejection
                    ? {
                        requestId: original.id,
                        revision: 1,
                        deadline: original.deadline,
                        retired: true,
                        phase: 'failed' as const,
                        detail: safeDetail,
                      }
                    : undefined
                ),
              propose: () => Effect.die('No direct proposal'),
            }),
            Layer.succeed(Plan, {
              preview: () =>
                Effect.fail(
                  new Unavailable({
                    operation: 'synthetic-discovery',
                    cause: new Error('Synthetic private diagnostic'),
                  })
                ),
            }),
            Layer.succeed(Time, { now: () => Effect.succeed(500) })
          )
        )
      )
    );
    try {
      const attempts = await runtime.runPromise(Attempts);
      await runtime.runPromise(attempts.execute(original.id));
      expect(await Effect.runPromise(store.get(original.id))).toMatchObject({
        id: original.id,
        deadline: original.deadline,
        phase: 'failed',
        detail: knownRejection
          ? safeDetail
          : 'Planning dependency failed. No implementation dispatched.',
      });
      expect(JSON.stringify(await runtime.runPromise(attempts.observe(original.id)))).not.toContain(
        'Synthetic private diagnostic'
      );
    } finally {
      await runtime.dispose();
    }
  }
);

it('emits handoff after discovery without assigning the model adapter a discovery deadline', async () => {
  const { vi } = await import('vitest');
  let now = 1000;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  const phases: string[] = [];
  const runtime = ManagedRuntime.make(
    PlanLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(PlanningSource, {
            verify: () => Effect.succeed(undefined),
            read: () =>
              Effect.sync(() => {
                now = 31000;
                return {
                  ...input,
                  issues: [
                    {
                      number: 42,
                      url: 'https://github.com/rafaeltab/wallpaperdb/issues/42',
                      title: 'Ready repair',
                      body: 'Authorized scope',
                      author: 'rafaeltab',
                      open: true,
                      labels: ['ready-for-agent'],
                      comments: [],
                      blockers: [],
                      parents: [],
                      blockersReady: true,
                      prerequisiteEvidence: '',
                    },
                  ],
                };
              }),
          }),
          Layer.succeed(IPlanner, {
            ownership: () => Effect.succeed(undefined),
            propose: (_input, attempt) =>
              Effect.sync(() => {
                expect(attempt?.deadline).toBeUndefined();
                expect(phases).toEqual(attempt?.requestId ? ['discovery', 'handoff'] : []);
                return { selected: [], deferred: [] };
              }),
          })
        )
      )
    )
  );
  try {
    const plan = await runtime.runPromise(Plan);
    await runtime.runPromise(
      plan.preview({
        requestId: 'explicit',
        progress: (phase) =>
          Effect.sync(() => {
            phases.push(phase);
          }),
      })
    );
    expect(phases).toEqual(['discovery', 'handoff', 'freshness']);
    now = 1000;
    phases.length = 0;
    await runtime.runPromise(plan.preview());
  } finally {
    clock.mockRestore();
    await runtime.dispose();
  }
});
