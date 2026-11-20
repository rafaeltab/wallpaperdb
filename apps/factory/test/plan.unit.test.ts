import { Effect, Layer, ManagedRuntime, Option, Deferred } from 'effect';
import { controlledScheduleStore } from './fixtures/schedule-store.js';
import { Time, Unavailable } from '../src/capabilities/job/index.js';
import { TestClock } from 'effect/testing';
import { expect, it } from 'vitest';
import {
  Plan,
  PlanLive,
  PlanningDiscovery,
  PlanningDiscoveryLive,
  PlanningSource,
  IPlanner,
  ScheduleStore,
  type PlanningInput,
  type PlanningIssue,
  type Proposal,
} from '../src/capabilities/plan/index.js';
const issue: PlanningIssue = {
  number: 580,
  url: 'https://github.com/rafaeltab/wallpaperdb/issues/580',
  title: 'Fix browse',
  body: 'Requirements',
  author: 'rafaeltab',
  open: true,
  labels: ['ready-for-agent'],
  comments: [],
  blockers: [],
  parents: [],
  blockersReady: true,
  prerequisiteEvidence: '',
};
const selection = { issue: 580, reason: 'User-facing bug', includeCodeFromIssues: [] };
const proposal: Proposal = {
  selected: [{ issue: 580, reason: 'User-facing bug', includeCodeFromIssues: [] }],
  deferred: [],
};

it.each(
  [false, true].flatMap((automatic) =>
    (['accepted', 'rejected', 'failed', 'cancelled'] as const).map((outcome) => ({
      automatic,
      outcome,
    }))
  )
)(
  'owns prerequisite verification separately from collection and model time: $automatic, $outcome',
  async ({ automatic, outcome }) => {
    let observe: Plan['verification'];
    let entered = () => {};
    let finish = () => {};
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const finishPromise = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const input: PlanningInput = {
      issues: [issue],
      job: { kind: 'empty' },
      capacity: { concurrency: 1, admission: 1 },
    };
    const runtime = ManagedRuntime.make(
      PlanLive.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(PlanningSource, {
              read: () =>
                Effect.gen(function* () {
                  expect(yield* observe()).toBeNull();
                  yield* TestClock.adjust(1000);
                  return input;
                }),
              verify: () =>
                Effect.gen(function* () {
                  entered();
                  yield* Effect.promise(() => finishPromise);
                  if (outcome === 'failed')
                    return yield* Effect.fail(
                      new Unavailable({ operation: 'controlled-verification', cause: null })
                    );
                  return outcome === 'rejected' ? 'Prerequisite no longer ready' : undefined;
                }),
            }),
            Layer.succeed(IPlanner, {
              ownership: () => Effect.succeed(undefined),
              propose: () =>
                Effect.gen(function* () {
                  expect(yield* observe()).toBeNull();
                  yield* TestClock.adjust(9000);
                  return proposal;
                }),
            })
          )
        ),
        Layer.provideMerge(TestClock.layer())
      )
    );
    const abort = new AbortController();
    try {
      const plan = await runtime.runPromise(Plan);
      expect(typeof plan.verification).toBe('function');
      observe = plan.verification;
      const running = runtime.runPromiseExit(
        plan.preview(automatic ? { automatic: true, progress: () => Effect.void } : undefined),
        { signal: abort.signal }
      );
      await enteredPromise;
      expect(await runtime.runPromise(plan.verification())).toEqual({ startedAt: 10000 });
      await runtime.runPromise(TestClock.adjust(3000));
      expect(await runtime.runPromise(plan.verification())).toEqual({ startedAt: 10000 });
      if (outcome === 'cancelled') abort.abort();
      else finish();
      const result = await running;
      if (outcome === 'accepted' || outcome === 'rejected') {
        expect(result._tag).toBe('Success');
        if (result._tag === 'Success') {
          expect(result.value.selected).toEqual(outcome === 'accepted' ? proposal.selected : []);
          if (outcome === 'rejected')
            expect(result.value.rejected).toContainEqual({
              issue: 580,
              reason: 'Prerequisite no longer ready',
            });
        }
      } else expect(result._tag).toBe('Failure');
      expect(await runtime.runPromise(plan.verification())).toBeNull();
    } finally {
      abort.abort();
      finish();
      await runtime.dispose();
    }
  }
);

it.each(['empty', 'invalid', 'stale', 'paused'] as const)(
  'does not invent verification for a %s proposal',
  async (outcome) => {
    const phases: string[] = [];
    const runtime = ManagedRuntime.make(
      PlanLive.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(PlanningSource, {
              read: () =>
                Effect.succeed({
                  issues: [issue],
                  job: { kind: 'empty' as const },
                  capacity: { concurrency: 1, admission: 1 },
                }),
              verify: () => Effect.die('No selected prerequisites to verify'),
            }),
            Layer.succeed(IPlanner, {
              ownership: () => Effect.succeed(undefined),
              propose: () =>
                Effect.succeed(
                  outcome === 'stale' || outcome === 'paused'
                    ? { kind: outcome }
                    : {
                        selected: outcome === 'invalid' ? [{ ...selection, issue: 999 }] : [],
                        deferred: [],
                      }
                ),
            })
          )
        )
      )
    );
    try {
      const plan = await runtime.runPromise(Plan);
      const result = await runtime.runPromise(
        plan.preview({
          progress: (phase) =>
            Effect.sync(() => {
              phases.push(phase);
            }),
        })
      );
      expect(result.selected).toEqual([]);
      expect(result.kind).toBe(outcome === 'stale' || outcome === 'paused' ? outcome : 'preview');
      expect(phases).toEqual(['discovery', 'handoff']);
      expect(await runtime.runPromise(plan.verification())).toBeNull();
    } finally {
      await runtime.dispose();
    }
  }
);
async function preview(
  issues = [issue],
  proposed = proposal,
  changed = false,
  job: PlanningInput['job'] = { kind: 'empty' },
  verify: PlanningSource['verify'] = () => Effect.succeed(undefined)
) {
  let reads = 0;
  const input: PlanningInput = {
    issues,
    job,
    capacity: { concurrency: issues.length, admission: issues.length },
  };
  const runtime = ManagedRuntime.make(
    PlanLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(PlanningSource, {
            verify,
            read: () => Effect.sync(() => ({ ...input, issues: changed && reads++ ? [] : issues })),
          }),
          Layer.succeed(IPlanner, {
            ownership: () => Effect.succeed(undefined),
            propose: () => Effect.succeed(proposed),
          })
        )
      )
    )
  );
  try {
    return await runtime.runPromise(Effect.flatMap(Plan, (p) => p.preview()));
  } finally {
    await runtime.dispose();
  }
}
it('shows a semantic proposal without dispatch', async () => {
  expect((await preview()).selected).toEqual(proposal.selected);
});

it.each([false, true])(
  'uses supplied cycle discovery without recollecting changed inputs=%s',
  async (changed) => {
    const input: PlanningInput = {
      issues: [issue],
      job: { kind: 'empty' },
      capacity: { concurrency: 1, admission: 1 },
    };
    let reads = 0;
    const runtime = ManagedRuntime.make(
      PlanLive.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(PlanningSource, {
              verify: () => Effect.succeed(undefined),
              read: () =>
                Effect.sync(() => {
                  reads++;
                  return { ...input, issues: changed ? [] : input.issues };
                }),
            }),
            Layer.succeed(IPlanner, {
              ownership: () => Effect.succeed(undefined),
              propose: () => Effect.succeed(proposal),
            })
          )
        )
      )
    );
    try {
      const result = await runtime.runPromise(
        Effect.flatMap(Plan, (plan) =>
          plan.preview({ input, automatic: true, progress: () => Effect.void })
        )
      );
      expect(reads).toBe(0);
      expect(result.kind).toBe('preview');
      expect(result.selected).toEqual(proposal.selected);
    } finally {
      await runtime.dispose();
    }
  }
);

it.each([false, true])(
  'waits for brief cycle ownership without bypassing a retained batch=%s',
  async (retained) => {
    const store = controlledScheduleStore();
    if (retained)
      await Effect.runPromise(
        store.save({
          revision: 0,
          concurrency: 1,
          allowance: 1,
          paused: true,
          admissions: [],
          cycle: { requestId: 'retained', startedAt: 0, concurrency: 1, allowance: 1 },
        })
      );
    let busy = true;
    let models = 0;
    const runtime = ManagedRuntime.make(
      PlanLive.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(ScheduleStore, {
              ...store,
              withCycle: <A>(work: Effect.Effect<A, Unavailable>) =>
                Effect.suspend(() => {
                  if (busy) {
                    busy = false;
                    return Effect.succeed(Option.none<A>());
                  }
                  return store.withCycle(work);
                }),
            }),
            Layer.succeed(PlanningSource, {
              read: () =>
                Effect.succeed({
                  issues: [issue],
                  job: { kind: 'empty' },
                  capacity: { concurrency: 1, admission: 1 },
                }),
              verify: () => Effect.succeed(undefined),
            }),
            Layer.succeed(IPlanner, {
              ownership: () => Effect.succeed(undefined),
              propose: () =>
                Effect.sync(() => {
                  models++;
                  return proposal;
                }),
            })
          )
        )
      )
    );
    try {
      const result = runtime.runPromise(Effect.flatMap(Plan, (plan) => plan.preview()));
      if (retained) await expect(result).rejects.toMatchObject({ operation: 'plan-busy' });
      else expect((await result).selected).toEqual(proposal.selected);
      expect(models).toBe(retained ? 0 : 1);
    } finally {
      await runtime.dispose();
    }
  }
);

it.each([
  { ...issue, open: false },
  { ...issue, author: 'outsider' },
  { ...issue, labels: [] },
  { ...issue, labels: ['ready-for-agent', 'future-work'] },
  { ...issue, labels: ['ready-for-agent', 'spec'] },
  { ...issue, blockersReady: false },
  { ...issue, blockers: [580] },
])('rejects unsafe selection %#', async (candidate) => {
  const result = await preview([candidate]);
  expect(result.selected).toEqual([]);
  expect(result.rejected[0]?.reason).toBeTruthy();
});
it('rejects cycles even with claimed prerequisite readiness', async () => {
  expect(
    (
      await preview([
        { ...issue, blockers: [579] },
        { ...issue, number: 579, blockers: [580] },
      ])
    ).selected
  ).toEqual([]);
});
it.each([
  { ...selection, dependsOn: [579] },
  { ...selection, conflicts: [579] },
  { ...selection, issue: 999 },
  { ...selection, reason: '' },
])('retains semantic uncertainty %#', async (item) => {
  expect((await preview([issue], { selected: [item], deferred: [] })).selected).toEqual([]);
});
it('rejects duplicate proposals', async () => {
  expect(
    (
      await preview([issue], {
        selected: [...proposal.selected, ...proposal.selected],
        deferred: [],
      })
    ).selected
  ).toEqual([]);
});

it('collects once for an advisory preview even when later inputs would differ', async () => {
  expect(await preview([issue], proposal, true)).toMatchObject({
    kind: 'preview',
    selected: proposal.selected,
  });
});

it('keeps inferred API blockers and unselected work visible', async () => {
  const result = await preview([issue, { ...issue, number: 579 }], {
    selected: [],
    deferred: [{ issue: 580, reason: 'API contract unsettled with active work' }],
  });
  expect(result.selected).toEqual([]);
  expect(result.rejected).toEqual([
    { issue: 580, reason: 'API contract unsettled with active work' },
    { issue: 579, reason: 'Not selected by semantic planner' },
  ]);
});
it('does not propose an already parked job as fresh work', async () => {
  const job: PlanningInput['job'] = {
    kind: 'job',
    intent: {
      id: 'existing',
      issue: 580,
      issueUrl: issue.url,
      base: 'a'.repeat(40),
      context: '',
      branch: 'factory/existing',
      createdAt: 0,
      expectedStage: 'implementation',
    },
    execution: { kind: 'absent' },
    elapsedMs: 100,
    resume: { index: 0, questionId: 'q' },
  };
  const result = await preview([issue], proposal, false, job);
  expect(result.selected).toEqual([]);
  expect(result.rejected).toContainEqual({ issue: 580, reason: 'Already active or parked' });
});

it('rejects a proposal that both selects and defers the same issue', async () => {
  const result = await preview([issue], {
    selected: proposal.selected,
    deferred: [{ issue: 580, reason: 'API contract unsettled' }],
  });
  expect(result.selected).toEqual([]);
});

it('validates shared acyclic prerequisite context without blocking preview', async () => {
  const issues = Array.from({ length: 42 }, (_, index) => ({
    ...issue,
    number: 580 + index,
    open: index === 0,
    blockers: [581 + index, 582 + index].filter((number) => number < 622),
  }));
  const started = performance.now();
  const result = await preview(issues);
  expect(result.selected).toEqual(proposal.selected);
  expect(performance.now() - started).toBeLessThan(1000);
});

it('rejects a cycle behind shared prerequisites without rejecting an independent issue', async () => {
  const result = await preview(
    [
      { ...issue, blockers: [581, 582] },
      { ...issue, number: 581, blockers: [583] },
      { ...issue, number: 582, blockers: [583] },
      { ...issue, number: 583, blockers: [581] },
      { ...issue, number: 584 },
    ],
    {
      selected: [
        { ...selection, includeCodeFromIssues: [581, 582] },
        { ...selection, issue: 584 },
      ],
      deferred: [],
    }
  );
  expect(result.selected).toEqual([{ ...selection, issue: 584 }]);
  expect(result.rejected).toContainEqual({ issue: 580, reason: 'Cyclic explicit dependencies' });
});

it('rejects a context-only issue even when it otherwise passes every candidate policy', async () => {
  const context = {
    ...issue,
    metadata: {
      number: issue.number,
      url: issue.url,
      title: issue.title,
      open: true,
      candidate: false,
      labels: issue.labels,
      assignees: [],
      projectStatus: null,
      projectPriority: null,
      projectSize: null,
      commentCount: 0,
      blockers: [],
      parents: [],
      pullRequests: [],
    },
  };
  const result = await preview([context]);
  expect(result.selected).toEqual([]);
  expect(result.rejected).toContainEqual({ issue: 580, reason: 'Context-only issue' });
  const candidate = { ...context, metadata: { ...context.metadata, candidate: true } };
  expect((await preview([candidate])).selected).toEqual(proposal.selected);
});

it.each([
  [3, 2, 2],
  [-1, 2, 2],
  [3, -1, 3],
  [-1, -1, 4],
  [0, 2, 0],
])(
  'bounds model selection by available concurrency %s and admissions %s',
  async (concurrency, admission, expected) => {
    const inputs: PlanningInput[] = [];
    const input: PlanningInput = {
      issues: [580, 581, 582, 583].map((number) => ({ ...issue, number })),
      job: { kind: 'empty' },
      capacity: { concurrency, admission },
    };
    const runtime = ManagedRuntime.make(
      PlanLive.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(PlanningSource, {
              verify: () => Effect.succeed(undefined),
              read: () => Effect.succeed(input),
            }),
            Layer.succeed(IPlanner, {
              ownership: () => Effect.succeed(undefined),
              propose: (value) =>
                Effect.sync(() => {
                  inputs.push(value);
                  return { selected: [], deferred: [] };
                }),
            })
          )
        )
      )
    );
    try {
      await runtime.runPromise(Effect.flatMap(Plan, (plan) => plan.preview()));
      if (expected === 0) expect(inputs).toEqual([]);
      else expect(inputs[0]).toHaveProperty('maximumSelections', expected);
    } finally {
      await runtime.dispose();
    }
  }
);

it('rejects inclusion of its own unfinished code', async () => {
  expect(
    (
      await preview([issue], {
        selected: [{ ...selection, includeCodeFromIssues: [580] }],
        deferred: [],
      })
    ).selected
  ).toEqual([]);
});
it('rejects inclusion of another new implementation in the same batch', async () => {
  expect(
    (
      await preview([issue, { ...issue, number: 579 }], {
        selected: [selection, { ...selection, issue: 579, includeCodeFromIssues: [580] }],
        deferred: [],
      })
    ).selected
  ).toEqual([]);
});

it('invalidates a response omitting a mandatory open prerequisite', async () => {
  const result = await preview([
    { ...issue, blockers: [579] },
    { ...issue, number: 579, open: true, labels: [] },
  ]);
  expect(result.selected).toEqual([]);
  expect(result.rejected).toContainEqual({
    issue: 580,
    reason: 'Mandatory prerequisite omitted from inclusion list',
  });
});
it('does not veto independent selected work because an overlapping backlog item is unselected', async () => {
  const result = await preview([issue, { ...issue, number: 579, title: 'Another browse repair' }]);
  expect(result.selected).toEqual(proposal.selected);
});

it('requires verification of every inclusion and retains no executable subset of an unverifiable batch', async () => {
  const result = await preview(
    [issue, { ...issue, number: 579 }],
    {
      selected: [selection, { ...selection, issue: 579 }],
      deferred: [],
    },
    false,
    { kind: 'empty' },
    (selected) =>
      Effect.succeed(
        selected.issue === 579 ? 'Included PR is not independently reviewed' : undefined
      )
  );
  expect(result.selected).toEqual([]);
  expect(result.rejected).toContainEqual({
    issue: 579,
    reason: 'Included PR is not independently reviewed',
  });
});

it.each(['none', 'discovery', 'preparation'] as const)(
  'reports actual initial gathering and clears it before the model, failure=%s',
  async (fail) => {
    let now = 1000;
    const gate = Deferred.makeUnsafe<void>();
    const entered = Deferred.makeUnsafe<void>();
    const input: PlanningInput = {
      issues: [issue],
      job: { kind: 'empty' },
      capacity: { concurrency: 1, admission: 1 },
    };
    let modelCalls = 0;
    let discovery: PlanningDiscovery;
    const deps = Layer.mergeAll(
      Layer.succeed(Time, { now: () => Effect.sync(() => now) }),
      Layer.succeed(PlanningSource, {
        verify: () => Effect.succeed(undefined),
        read: () =>
          Effect.gen(function* () {
            yield* Deferred.succeed(entered, undefined);
            yield* Deferred.await(gate);
            if (fail === 'discovery')
              return yield* Effect.fail(
                new Unavailable({ operation: 'discovery-offline', cause: null })
              );
            return input;
          }),
      }),
      Layer.succeed(IPlanner, {
        ownership: () => Effect.succeed(undefined),
        propose: (_input, attempt) =>
          Effect.gen(function* () {
            modelCalls++;
            expect((yield* discovery.snapshot()).current).toEqual([
              { id: 'planning-preparation:2', startedAt: 5000 },
            ]);
            if (fail === 'preparation')
              return yield* Effect.fail(
                new Unavailable({ operation: 'preparation-offline', cause: null })
              );
            yield* attempt?.prepared ?? Effect.void;
            const facts = yield* discovery.snapshot();
            expect(facts.current).toEqual([]);
            expect(facts.completedAt).toBe(5000);
            return proposal;
          }),
      })
    );
    const runtime = ManagedRuntime.make(
      PlanLive.pipe(Layer.provideMerge(PlanningDiscoveryLive.pipe(Layer.provideMerge(deps))))
    );
    try {
      discovery = await runtime.runPromise(PlanningDiscovery);
      const pending = runtime.runPromise(
        Effect.flatMap(Plan, (p) => p.preview()).pipe(Effect.result)
      );
      await runtime.runPromise(Deferred.await(entered));
      now = 5000;
      const facts = await runtime.runPromise(
        Effect.flatMap(PlanningDiscovery, (d) => d.snapshot())
      );
      expect(facts.current).toEqual([{ id: 'planning-discovery:1', startedAt: 1000 }]);
      await runtime.runPromise(Deferred.succeed(gate, undefined));
      const result = await pending;
      expect(result._tag).toBe(fail === 'none' ? 'Success' : 'Failure');
      expect(modelCalls).toBe(fail === 'discovery' ? 0 : 1);
      const finished = await runtime.runPromise(
        Effect.flatMap(PlanningDiscovery, (d) => d.snapshot())
      );
      expect(finished.current).toEqual([]);
      expect(finished.outcome).toBe(fail === 'none' ? 'ready-matches' : 'unknown');
      expect(fail === 'none' ? finished.completedAt : finished.failedAt).toBe(5000);
    } finally {
      await runtime.dispose();
    }
  }
);

it.each([false, true])('reports only model responsibility for automatic=%s', async (automatic) => {
  const { Time } = await import('../src/capabilities/job/index.js');
  let now = 1000;
  let enterDiscovery!: () => void;
  let releaseDiscovery!: () => void;
  const discovering = new Promise<void>((resolve) => {
    enterDiscovery = resolve;
  });
  const discovery = new Promise<void>((resolve) => {
    releaseDiscovery = resolve;
  });
  let enterVerification!: () => void;
  let releaseVerification!: () => void;
  const verifying = new Promise<void>((resolve) => {
    enterVerification = resolve;
  });
  const verification = new Promise<void>((resolve) => {
    releaseVerification = resolve;
  });
  let owner: import('../src/capabilities/plan/index.js').PlannerOwnership | undefined;
  let enterPreparation!: () => void;
  let releasePreparation!: () => void;
  const preparing = new Promise<void>((resolve) => {
    enterPreparation = resolve;
  });
  const preparation = new Promise<void>((resolve) => {
    releasePreparation = resolve;
  });
  let releaseModel!: (value: Proposal) => void;
  let enterModel!: () => void;
  const entered = new Promise<void>((resolve) => {
    enterModel = resolve;
  });
  const model = new Promise<Proposal>((resolve) => {
    releaseModel = resolve;
  });
  const runtime = ManagedRuntime.make(
    PlanLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(Time, { now: () => Effect.sync(() => now) }),
          Layer.succeed(PlanningSource, {
            read: () =>
              Effect.promise(async () => {
                enterDiscovery();
                await discovery;
                now = 2000;
                return {
                  issues: [issue],
                  job: { kind: 'empty' as const },
                  capacity: { concurrency: 1, admission: 1 },
                };
              }),
            verify: () =>
              Effect.promise(async () => {
                enterVerification();
                await verification;
                return undefined;
              }),
          }),
          Layer.succeed(IPlanner, {
            ownership: () => Effect.sync(() => owner),
            propose: () =>
              Effect.promise(async () => {
                enterPreparation();
                await preparation;
                owner = {
                  requestId: 'controlled-model',
                  revision: 0,
                  phase: 'running',
                  modelHandedOffAt: now,
                };
                enterModel();
                const result = await model;
                owner = { ...owner, phase: 'succeeded' };
                return result;
              }),
          })
        )
      )
    )
  );
  try {
    const plan = await runtime.runPromise(Plan);
    if (!plan.activity) throw new Error('Missing planning activity read port');
    const work = runtime.runPromise(plan.preview({ automatic, progress: () => Effect.void }));
    await discovering;
    const duringDiscovery = await runtime.runPromise(plan.activity());
    releaseDiscovery();
    await preparing;
    const beforeHandoff = await runtime.runPromise(plan.activity());
    now = 2500;
    releasePreparation();
    await entered;
    const duringModel = await runtime.runPromise(plan.activity());
    now = 3000;
    releaseModel(proposal);
    await verifying;
    const duringVerification = await runtime.runPromise(plan.activity());
    releaseVerification();
    await work;
    expect(duringDiscovery.current).toBeUndefined();
    expect(duringVerification.current).toBeUndefined();
    expect(beforeHandoff.current).toBeUndefined();
    expect(duringModel.current).toEqual({ id: 'controlled-model', startedAt: 2500 });
    expect(await runtime.runPromise(plan.activity())).toMatchObject({
      assessment: { outcome: 'eligible', observedAt: 3000 },
    });
  } finally {
    await runtime.dispose();
  }
});

it.each([
  'failed',
  'stale',
  'paused',
  'rejected',
  'unverifiable',
  'eligible',
  'no-eligible',
  'empty-filter',
] as const)('retains honest assessment evidence for %s outcomes', async (outcome) => {
  const { Time, Unavailable } = await import('../src/capabilities/job/index.js');
  let models = 0;
  const runtime = ManagedRuntime.make(
    PlanLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(Time, { now: () => Effect.succeed(2000) }),
          Layer.succeed(PlanningSource, {
            read: () =>
              Effect.succeed({
                issues: outcome === 'empty-filter' ? [] : [issue],
                job: { kind: 'empty' as const },
                capacity: { concurrency: 1, admission: 1 },
              }),
            verify: () =>
              Effect.succeed(outcome === 'unverifiable' ? 'Missing reviewed code' : undefined),
          }),
          Layer.succeed(IPlanner, {
            ownership: () => Effect.succeed(undefined),
            propose: () =>
              Effect.suspend((): ReturnType<IPlanner['propose']> => {
                models++;
                if (outcome === 'failed')
                  return Effect.fail(
                    new Unavailable({ operation: 'model-unavailable', cause: null })
                  );
                if (outcome === 'stale' || outcome === 'paused')
                  return Effect.succeed({ kind: outcome });
                return Effect.succeed(
                  outcome === 'no-eligible'
                    ? { selected: [], deferred: [] }
                    : outcome === 'rejected'
                      ? { selected: [{ ...selection, issue: 999 }], deferred: [] }
                      : proposal
                );
              }),
          })
        )
      )
    )
  );
  try {
    const plan = await runtime.runPromise(Plan);
    if (!plan.activity) throw new Error('Missing planning activity read port');
    await runtime.runPromise(plan.preview().pipe(Effect.exit));
    const facts = await runtime.runPromise(plan.activity());
    expect(facts.current).toBeUndefined();
    if (outcome === 'eligible' || outcome === 'no-eligible')
      expect(facts.assessment?.outcome).toBe(outcome);
    else expect(facts.assessment).toBeUndefined();
    expect(models).toBe(outcome === 'empty-filter' ? 0 : 1);
  } finally {
    await runtime.dispose();
  }
});

it.each(['running', 'uncertain', 'succeeded', 'failed'] as const)(
  'uses retained model ownership after restart for %s',
  async (phase) => {
    const runtime = ManagedRuntime.make(
      PlanLive.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(PlanningSource, {
              read: () => Effect.die('Activity must not discover'),
              verify: () => Effect.die('Activity must not verify'),
            }),
            Layer.succeed(IPlanner, {
              ownership: () =>
                Effect.succeed({
                  requestId: 'retained-model',
                  revision: 1,
                  phase,
                  modelHandedOffAt: 1234,
                }),
              propose: () => Effect.die('Activity must not launch'),
            })
          )
        )
      )
    );
    try {
      const plan = await runtime.runPromise(Plan);
      if (!plan.activity) throw new Error('Missing planning activity read port');
      const facts = await runtime.runPromise(plan.activity());
      expect(facts.current).toEqual(
        phase === 'running' ? { id: 'retained-model', startedAt: 1234 } : undefined
      );
      expect(facts.assessment).toBeUndefined();
    } finally {
      await runtime.dispose();
    }
  }
);
