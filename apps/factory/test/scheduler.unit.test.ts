import { controlledPlanningSafetyLayer } from './fixtures/planning-safety.js';
import { Time } from '../src/capabilities/job/index.js';
import { Effect, Layer, ManagedRuntime, Deferred } from 'effect';
import { expect, it } from 'vitest';
import {
  PlanLive,
  Plan,
  PlanningSource,
  IPlanner,
  Scheduler,
  SchedulerLive,
  ScheduleStore,
  ScheduleObservations,
  JobPool,
  type PlanningIssue,
  type ScheduleStatus,
} from '../src/capabilities/plan/index.js';
import { Unavailable, Issues, type Job, type Status } from '../src/capabilities/job/index.js';
import { controlledScheduleStore } from './fixtures/schedule-store.js';
const base = 'a'.repeat(40);
const issue = (number: number): PlanningIssue => ({
  number,
  url: `https://github.com/rafaeltab/wallpaperdb/issues/${number}`,
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
});
function fixture(hooks?: { read: () => void; propose: (deadline?: number) => void }) {
  const persisted = controlledScheduleStore();
  let failSelection = false;
  const store = {
    ...persisted,
    save: (next: import('../src/capabilities/plan/index.js').ScheduleState) =>
      failSelection && next.cycle?.selected !== undefined
        ? Effect.fail(
            new Unavailable({ operation: 'controlled-selection-persistence', cause: null })
          )
        : persisted.save(next),
  };
  let planGate: Effect.Effect<void> = Effect.void;
  const proposals = new Map<string, import('../src/capabilities/plan/index.js').Proposal>();
  const preparationDecisions: boolean[] = [];
  const snapshot = () => Effect.runSync(store.read());
  const preparations: number[] = [];
  let recoveries: NonNullable<ScheduleStatus['recoveries']> = [];
  let prepared = false;
  let reconciliation: () => void = () => {};
  let duringPlan: (() => void) | undefined;
  const statuses = new Map<number, Status>();
  const launches: number[] = [];
  const resumed: number[] = [];
  const jobs = new Map<number, Job>();
  const pool: JobPool = {
    job: (number) =>
      Effect.sync(() => {
        let job = jobs.get(number);
        if (!job) {
          job = {
            retry: () => Effect.die('Unexpected fresh retry in this fixture'),
            status: () => Effect.sync(() => statuses.get(number) ?? { kind: 'empty' }),
            start: (command) =>
              Effect.sync(() => {
                if (statuses.has(number)) return { kind: 'occupied' as const };
                launches.push(number);
                const status: Status = {
                  kind: 'job',
                  intent: {
                    ...command,
                    id: String(number),
                    issueUrl: issue(number).url,
                    branch: `factory/${number}`,
                    createdAt: 0,
                    expectedStage: 'implementation',
                  },
                  elapsedMs: 0,
                  execution: { kind: 'absent' },
                };
                statuses.set(number, status);
                return status;
              }),
            resume: () =>
              Effect.sync(() => {
                resumed.push(number);
                const status = statuses.get(number);
                if (status?.kind !== 'job') return { kind: 'rejected' as const };
                const result = {
                  ...status,
                  delivery: {
                    stage: 'implementation' as const,
                    commit: base,
                    ready: false,
                    landed: false,
                    active: true,
                  },
                };
                statuses.set(number, result);
                return result;
              }),
            cancel: () =>
              Effect.sync(() => {
                const status = statuses.get(number);
                if (status?.kind !== 'job') return { kind: 'rejected' as const };
                const result = {
                  ...status,
                  delivery: {
                    stage: 'implementation' as const,
                    commit: base,
                    ready: false,
                    landed: false,
                    active: false,
                    activity: 'cancelled' as const,
                  },
                };
                statuses.set(number, result);
                return result;
              }),
          };
          jobs.set(number, job);
        }
        return job;
      }),
  };
  const published: ScheduleStatus[] = [];
  let discoveryFailed = false;
  let publicationFailed = false;
  let issues = [1, 2, 3, 4].map(issue);
  const source = {
    verify: () => Effect.succeed(undefined),
    read: () =>
      discoveryFailed
        ? Effect.fail(new Unavailable({ operation: 'controlled-discovery', cause: 'offline' }))
        : Effect.sync(() => {
            hooks?.read();
            return {
              issues,
              job: { kind: 'empty' as const },
              jobs: [...statuses.values()],
              scheduleRevision: snapshot().revision,
              admissions: snapshot().admissions.map((a) => a.issue),
              paused: snapshot().paused,
              capacity: { concurrency: snapshot().concurrency, admission: snapshot().allowance },
            };
          }),
  };
  const deps = Layer.mergeAll(
    Layer.succeed(ScheduleObservations, {
      publish: (value) =>
        publicationFailed
          ? Effect.fail(
              new Unavailable({ operation: 'controlled-publication', cause: 'storage unavailable' })
            )
          : Effect.sync(() => {
              published.push(value);
            }),
    }),
    Layer.succeed(Issues, {
      recoveries: () => Effect.sync(() => recoveries),
      reconcile: () => Effect.sync(() => reconciliation()),
      prepare: (number, authorize) =>
        Effect.gen(function* () {
          if (authorize) preparationDecisions.push(yield* authorize(number));
          preparations.push(number);
          if (prepared)
            issues = issues.map((i) =>
              i.number === number
                ? {
                    ...i,
                    blockersReady: true,
                    joinRequired: false,
                    prerequisite: {
                      base: 'b'.repeat(40),
                      prBase: 'factory/C',
                      evidence: 'CI verified join',
                    },
                  }
                : i
            );
        }),
      inspect: (number) =>
        Effect.sync(() => {
          const candidate = issues.find((i) => i.number === number);
          return {
            selectionBase: base,
            open: candidate?.open ?? false,
            author: candidate?.author ?? '',
            labels: candidate?.labels ?? [],
            blockers: candidate?.blockers ?? [],
            blockersReady: candidate?.blockersReady ?? false,
            joinRequired: candidate?.joinRequired,
            url: issue(number).url,
            prerequisite:
              candidate?.prerequisite ??
              (candidate?.blockersReady ? { base, prBase: 'main', evidence: '[]' } : undefined),
          };
        }),
      pullRequest: () => Effect.succeed({ kind: 'absent' as const }),
    }),
    Layer.succeed(ScheduleStore, store),
    Layer.succeed(JobPool, pool),
    Layer.succeed(PlanningSource, source),
    Layer.succeed(IPlanner, {
      ownership: () => Effect.succeed(undefined),
      propose: (_input, attempt) =>
        Effect.gen(function* () {
          const retained = attempt?.requestId ? proposals.get(attempt.requestId) : undefined;
          if (retained) return retained;
          hooks?.propose(attempt?.deadline);
          duringPlan?.();
          yield* planGate;
          const proposal = {
            selected: issues
              .filter(
                (i) =>
                  !_input.admissions?.includes(i.number) &&
                  !i.blockers.some((number) =>
                    _input.jobs?.some(
                      (job) =>
                        job.kind === 'job' &&
                        job.intent.issue === number &&
                        !job.delivery?.ready &&
                        !job.delivery?.landed
                    )
                  )
              )
              .slice(0, _input.maximumSelections)
              .map((i) => ({
                issue: i.number,
                reason: 'Thin user-facing slice',
                includeCodeFromIssues: i.blockers,
              })),
            deferred: [],
          };
          if (attempt?.requestId) proposals.set(attempt.requestId, proposal);
          return proposal;
        }),
    })
  );
  const layers = SchedulerLive.pipe(
    Layer.provide(controlledPlanningSafetyLayer),
    Layer.provide(Layer.succeed(Time, { now: () => Effect.succeed(0) })),
    Layer.provideMerge(PlanLive.pipe(Layer.provide(deps))),
    Layer.provide(deps)
  );
  let runtime = ManagedRuntime.make(layers);
  return {
    get runtime() {
      return runtime;
    },
    reopen: async () => {
      await runtime.dispose();
      runtime = ManagedRuntime.make(layers);
    },
    setRecoveries: (values: NonNullable<ScheduleStatus['recoveries']>) => {
      recoveries = values;
    },
    statuses,
    published,
    preparationDecisions,
    gatePlan: (gate: Effect.Effect<void>) => {
      planGate = gate;
    },
    failSelectedPersistence: (value: boolean) => {
      failSelection = value;
    },
    failDiscovery: () => {
      discoveryFailed = true;
    },
    failPublication: () => {
      publicationFailed = true;
    },
    launches,
    resumed,
    preparations,
    onReconcile: (callback: () => void) => {
      reconciliation = callback;
    },
    prepareSucceeds: () => {
      prepared = true;
    },
    setIssues: (next: PlanningIssue[]) => {
      issues = next;
    },
    run: <A>(
      f: (s: Scheduler) => Effect.Effect<A, import('../src/capabilities/job/index.js').Unavailable>
    ) => runtime.runPromise(Effect.flatMap(Scheduler, f)),
    snapshot,
    store,
    duringPlan: (callback: () => void) => {
      duringPlan = callback;
    },
  };
}
it('reserves the initial distinct allowance and does not launch twice under repeated events', async () => {
  const f = fixture();
  try {
    await f.run((s) => s.tick(base));
    await f.run((s) => s.tick(base));
    expect(f.launches).toEqual([1]);
    expect(f.snapshot().admissions.map((a) => a.issue)).toEqual([1]);
  } finally {
    await f.runtime.dispose();
  }
});

it.each(['unlabelled', 'omitted'] as const)(
  'preserves admitted work when its issue is %s in the ready pool',
  async (representation) => {
    const f = fixture();
    try {
      await f.run((s) =>
        s.configure({ revision: -1, concurrency: 1, allowance: -1, paused: false })
      );
      await f.run((s) => s.tick(base));
      const first = f.statuses.get(1);
      const admissions = f.snapshot().admissions;
      expect(f.launches).toEqual([1]);
      f.setIssues([
        ...(representation === 'unlabelled' ? [{ ...issue(1), labels: [] }] : []),
        { ...issue(2), labels: [] },
        issue(3),
      ]);
      const observed = await f.run((s) => s.tick(base));
      expect(observed.jobs).toEqual([first]);
      expect(f.statuses.get(1)).toEqual(first);
      expect(f.snapshot().admissions).toEqual(admissions);
      expect(f.launches).toEqual([1]);
      expect(f.resumed).toEqual([]);
    } finally {
      await f.runtime.dispose();
    }
  }
);

it.each(['ready', 'landed'] as const)(
  'refills a %s slot while two other jobs continue and retains CI waits',
  async (outcome) => {
    const f = fixture();
    try {
      await f.run((s) =>
        s.configure({ revision: -1, concurrency: 3, allowance: -1, paused: false })
      );
      await f.run((s) => s.tick(base));
      expect(f.launches).toEqual([1, 2, 3]);
      const first = f.statuses.get(1);
      if (first?.kind !== 'job') throw new Error('Missing first job');
      f.statuses.set(1, {
        ...first,
        delivery: {
          stage: 'ci',
          commit: base,
          ready: outcome === 'ready',
          landed: outcome === 'landed',
        },
      });
      await f.run((s) => s.tick(base));
      expect(f.launches).toEqual([1, 2, 3, 4]);
    } finally {
      await f.runtime.dispose();
    }
  }
);
it('releases a parked slot without satisfying its dependent and admits unrelated work', async () => {
  const f = fixture();
  try {
    await f.run((s) => s.configure({ revision: -1, concurrency: 1, allowance: -1, paused: false }));
    await f.run((s) => s.tick(base));
    const first = f.statuses.get(1);
    if (first?.kind !== 'job') throw new Error('Missing job');
    f.statuses.set(1, {
      ...first,
      delivery: {
        stage: 'implementation',
        activity: 'awaiting-answer',
        active: false,
        commit: base,
        ready: false,
        landed: false,
      },
    });
    f.setIssues([
      issue(1),
      { ...issue(2), blockers: [1], blockersReady: false, joinRequired: true },
      issue(3),
    ]);
    await f.run((s) => s.tick(base));
    expect(f.launches).toEqual([1, 3]);
    expect(f.preparations).toEqual([]);
  } finally {
    await f.runtime.dispose();
  }
});
it('persists pause and reductions without cancelling jobs; rejects stale control edits', async () => {
  const f = fixture();
  try {
    expect(
      await f.run((s) =>
        s.configure({ revision: -1, concurrency: -1, allowance: -1, paused: true })
      )
    ).toBe('saved');
    await f.run((s) => s.tick(base));
    expect(f.launches).toEqual([]);
    expect(
      await f.run((s) => s.configure({ revision: -1, concurrency: 3, allowance: 3, paused: false }))
    ).toBe('conflict');
    await f.run((s) => s.configure({ revision: 0, concurrency: 3, allowance: 3, paused: false }));
    await f.run((s) => s.tick(base));
    expect(f.launches).toEqual([1, 2, 3]);
    await f.run((s) =>
      s.configure({ revision: f.snapshot().revision, concurrency: 1, allowance: 1, paused: false })
    );
    await f.run((s) => s.tick(base));
    expect(f.launches).toEqual([1, 2, 3]);
    expect((await f.run((s) => s.status())).jobs).toHaveLength(3);
  } finally {
    await f.runtime.dispose();
  }
});
it.each([0, -2, 1.5, Number.NaN])('rejects invalid limits %s', async (value) => {
  const f = fixture();
  try {
    expect(
      await f.run((s) =>
        s.configure({ revision: -1, concurrency: value, allowance: 1, paused: false })
      )
    ).toBe('rejected');
  } finally {
    await f.runtime.dispose();
  }
});

it('recovers a reservation made before launch and does not charge another admission', async () => {
  const f = fixture();
  try {
    await Effect.runPromise(
      f.store.save({
        ...f.snapshot(),
        revision: 0,
        admissions: [{ issue: 1, base, context: 'Retained scope' }],
      })
    );
    await f.run((s) => s.tick(base));
    await f.run((s) => s.tick(base));
    expect(f.launches).toEqual([1]);
    expect(f.snapshot().admissions).toEqual([{ issue: 1, base, context: 'Retained scope' }]);
  } finally {
    await f.runtime.dispose();
  }
});
it('rejects proposals made stale by changing requirements', async () => {
  const f = fixture();
  try {
    f.duringPlan(() => f.setIssues([{ ...issue(1), body: 'Changed authorized scope' }]));
    await f.run((s) => s.tick(base));
    expect(f.launches).toEqual([]);
    expect(f.snapshot().admissions).toEqual([]);
  } finally {
    await f.runtime.dispose();
  }
});
it('does not admit a proposal when admissions are paused during planning', async () => {
  const f = fixture();
  try {
    f.duringPlan(() =>
      Effect.runSync(
        f.store.save({ ...f.snapshot(), revision: f.snapshot().revision + 1, paused: true })
      )
    );
    await f.run((s) => s.tick(base));
    expect(f.launches).toEqual([]);
  } finally {
    await f.runtime.dispose();
  }
});
it.each(['review', 'publication', 'ci'] as const)(
  'counts %s waiting in active capacity',
  async (stage) => {
    const f = fixture();
    try {
      await f.run((s) =>
        s.configure({ revision: -1, concurrency: 1, allowance: -1, paused: false })
      );
      await f.run((s) => s.tick(base));
      const first = f.statuses.get(1);
      if (first?.kind !== 'job') throw new Error('Missing job');
      f.statuses.set(1, {
        ...first,
        delivery: {
          stage,
          activity: 'waiting-for-github',
          commit: base,
          ready: false,
          landed: false,
        },
      });
      await f.run((s) => s.tick(base));
      expect(f.launches).toEqual([1]);
    } finally {
      await f.runtime.dispose();
    }
  }
);

it('allows unlimited concurrency and allowance without charging replayed admissions', async () => {
  const f = fixture();
  try {
    await f.run((s) =>
      s.configure({ revision: -1, concurrency: -1, allowance: -1, paused: false })
    );
    await f.run((s) => s.tick(base));
    expect(f.launches).toEqual([1, 2, 3, 4]);
    await f.run((s) => s.tick(base));
    expect(f.snapshot().admissions.map((a) => a.issue)).toEqual([1, 2, 3, 4]);
    expect(await f.run((s) => s.start({ issue: 1, base, context: '' }))).toEqual({
      kind: 'occupied',
    });
  } finally {
    await f.runtime.dispose();
  }
});

it('requires active capacity to resume parked work and does not consume a fresh allowance', async () => {
  const f = fixture();
  try {
    await f.run((s) => s.configure({ revision: -1, concurrency: 1, allowance: -1, paused: false }));
    await f.run((s) => s.tick(base));
    const first = f.statuses.get(1);
    if (first?.kind !== 'job') throw new Error('Missing first job');
    f.statuses.set(1, {
      ...first,
      delivery: {
        stage: 'implementation',
        active: false,
        activity: 'awaiting-answer',
        commit: base,
        ready: false,
        landed: false,
      },
    });
    await f.run((s) => s.tick(base));
    expect(f.launches).toEqual([1, 2]);
    expect(await f.run((s) => s.resume({ jobId: '1', index: 0, questionId: 'q' }))).toEqual({
      kind: 'occupied',
    });
    expect(f.resumed).toEqual([]);
    await f.run((s) =>
      s.configure({ revision: f.snapshot().revision, concurrency: 2, allowance: 1, paused: true })
    );
    expect(await f.run((s) => s.resume({ jobId: '1', index: 0, questionId: 'q' }))).toMatchObject({
      kind: 'job',
    });
    expect(f.resumed).toEqual([1]);
    expect(f.snapshot().admissions.map((a) => a.issue)).toEqual([1, 2]);
  } finally {
    await f.runtime.dispose();
  }
});

it('rejects invalid or ineligible manual requests without consuming the distinct allowance', async () => {
  const f = fixture();
  try {
    expect(await f.run((s) => s.start({ issue: 1, base: 'bad', context: '' }))).toEqual({
      kind: 'rejected',
    });
    f.setIssues([{ ...issue(1), author: 'outside' }]);
    expect(await f.run((s) => s.start({ issue: 1, base, context: '' }))).toEqual({
      kind: 'rejected',
    });
    expect(f.snapshot().admissions).toEqual([]);
    f.setIssues([issue(1)]);
    expect(await f.run((s) => s.start({ issue: 1, base, context: '' }))).toMatchObject({
      kind: 'job',
    });
  } finally {
    await f.runtime.dispose();
  }
});
it('cancels only the identified job while retaining its admission', async () => {
  const f = fixture();
  try {
    expect(await f.run((s) => s.cancel('missing'))).toEqual({ kind: 'rejected' });
    await f.run((s) => s.configure({ revision: -1, concurrency: 2, allowance: -1, paused: false }));
    await f.run((s) => s.tick(base));
    expect(await f.run((s) => s.cancel('1'))).toMatchObject({
      kind: 'job',
      delivery: { activity: 'cancelled' },
    });
    expect(f.statuses.get(2)).toMatchObject({ kind: 'job', execution: { kind: 'absent' } });
    expect(f.snapshot().admissions.map((a) => a.issue)).toEqual([1, 2]);
  } finally {
    await f.runtime.dispose();
  }
});

it('retains an uncertain resumed slot across recovery until the existing job is reconciled', async () => {
  const f = fixture();
  try {
    await f.run((s) => s.start({ issue: 1, base, context: 'Retained scope' }));
    const first = f.statuses.get(1);
    if (first?.kind !== 'job') throw new Error('Missing first job');
    f.statuses.set(1, {
      ...first,
      delivery: {
        stage: 'implementation',
        active: false,
        commit: base,
        ready: false,
        landed: false,
        activity: 'awaiting-answer',
      },
    });
    await Effect.runPromise(
      f.store.save({
        ...f.snapshot(),
        revision: f.snapshot().revision + 1,
        allowance: -1,
        resuming: [{ issue: 1, index: 0, questionId: 'q', run: { id: 'run-1', ordinal: 1 } }],
      })
    );
    await f.run((s) => s.tick(base));
    expect(f.launches).toEqual([1]);
    f.statuses.set(1, {
      ...first,
      execution: {
        kind: 'found',
        threadId: 'thread-1',
        status: 'running',
        worktree: '/worker',
        branch: first.intent.branch,
        model: 'gpt-6.1-sol',
        run: { id: 'run-2', ordinal: 2 },
      },
    });
    expect((await f.run((s) => s.status())).state.resuming).toEqual([]);
    expect(f.resumed).toEqual([]);
    expect(f.snapshot().admissions).toHaveLength(1);
  } finally {
    await f.runtime.dispose();
  }
});

it('does not manually admit a dependent of parked work even with claimed prerequisite readiness', async () => {
  const f = fixture();
  try {
    await f.run((s) => s.configure({ revision: -1, concurrency: 1, allowance: -1, paused: false }));
    await f.run((s) => s.start({ issue: 1, base, context: '' }));
    const first = f.statuses.get(1);
    if (first?.kind !== 'job') throw new Error('Missing first job');
    f.statuses.set(1, {
      ...first,
      delivery: {
        stage: 'implementation',
        active: false,
        activity: 'awaiting-answer',
        commit: base,
        ready: false,
        landed: false,
      },
    });
    f.setIssues([
      issue(1),
      { ...issue(2), blockers: [1], blockersReady: false, joinRequired: true },
      issue(3),
    ]);
    expect(await f.run((s) => s.start({ issue: 2, base, context: '' }))).toEqual({
      kind: 'rejected',
    });
    expect(f.launches).toEqual([1]);
    expect(await f.run((s) => s.start({ issue: 3, base, context: '' }))).toMatchObject({
      kind: 'job',
    });
    expect(f.launches).toEqual([1, 3]);
    expect(f.preparations).toEqual([]);
  } finally {
    await f.runtime.dispose();
  }
});

it('admits both forks at the verified prerequisite tip and retains their PR target', async () => {
  const f = fixture();
  const a = 'b'.repeat(40);
  try {
    await f.run((s) => s.configure({ revision: -1, concurrency: 2, allowance: -1, paused: false }));
    f.setIssues([issue(1)]);
    await f.run((s) => s.tick(base));
    const first = f.statuses.get(1);
    if (first?.kind !== 'job') throw new Error('Missing prerequisite');
    f.statuses.set(1, {
      ...first,
      delivery: { stage: 'ci', commit: a, ready: true, landed: false },
    });
    f.setIssues(
      [2, 3].map((number) => ({
        ...issue(number),
        blockers: [1],
        prerequisite: {
          base: a,
          prBase: 'factory/A',
          evidence: 'Issue 1, PR 10, reviewed A with passing CI',
        },
      }))
    );
    await f.run((s) => s.tick(base));
    expect(f.launches).toEqual([1, 2, 3]);
    expect(f.snapshot().admissions.slice(1)).toEqual(
      [2, 3].map((number) => ({
        issue: number,
        includeCodeFromIssues: [1],
        selectionBase: base,
        base: a,
        prBase: 'factory/A',
        context: '',
        prerequisiteEvidence: 'Issue 1, PR 10, reviewed A with passing CI',
      }))
    );
  } finally {
    await f.runtime.dispose();
  }
});

it('preserves the full supported maintainer context when binding prerequisite evidence', async () => {
  const f = fixture();
  try {
    f.setIssues([
      {
        ...issue(2),
        blockers: [1],
        prerequisite: { base: 'b'.repeat(40), prBase: 'factory/A', evidence: 'Verified A' },
      },
    ]);
    expect(
      await f.run((s) => s.start({ issue: 2, base, context: 'x'.repeat(16000) }))
    ).toMatchObject({ kind: 'job' });
    expect(f.snapshot().admissions[0]).toMatchObject({
      context: 'x'.repeat(16000),
      prerequisiteEvidence: 'Verified A',
      base: 'b'.repeat(40),
      prBase: 'factory/A',
    });
  } finally {
    await f.runtime.dispose();
  }
});

it('prepares a divergent join before reserving E and launches only from its verified tree', async () => {
  const f = fixture();
  try {
    f.setIssues([{ ...issue(5), blockers: [3, 4], blockersReady: false, joinRequired: true }]);
    await f.run((s) => s.tick(base));
    expect(f.preparations).toEqual([5]);
    expect(f.launches).toEqual([]);
    expect(f.snapshot().admissions).toEqual([]);
    f.prepareSucceeds();
    await f.run((s) => s.tick(base));
    expect(f.snapshot().admissions).toMatchObject([
      { issue: 5, base: 'b'.repeat(40), prBase: 'factory/C' },
    ]);
    expect(f.launches).toEqual([5]);
  } finally {
    await f.runtime.dispose();
  }
});

it('retries selected join preparation without asking the advisory planner again for unchanged input', async () => {
  const f = fixture();
  let plans = 0;
  f.duringPlan(() => {
    plans++;
  });
  f.setIssues([{ ...issue(5), blockers: [3, 4], blockersReady: false, joinRequired: true }]);
  try {
    await f.run((s) => s.tick(base));
    f.prepareSucceeds();
    await f.run((s) => s.tick(base));
    expect(plans).toBe(1);
    expect(f.preparations).toEqual([5, 5]);
    expect(f.launches).toEqual([5]);
  } finally {
    await f.runtime.dispose();
  }
});

it('rejects cyclic join proposals before preparing any branches', async () => {
  const f = fixture();
  f.setIssues([
    { ...issue(4), blockers: [5], blockersReady: false, joinRequired: true },
    { ...issue(5), blockers: [4], blockersReady: false, joinRequired: true },
  ]);
  try {
    await f.run((s) => s.tick(base));
    expect(f.preparations).toEqual([]);
    expect(f.launches).toEqual([]);
    expect(f.snapshot().admissions).toEqual([]);
  } finally {
    await f.runtime.dispose();
  }
});

it('reconciles an existing join while its prerequisite CI wait occupies the last slot', async () => {
  const f = fixture();
  try {
    f.setIssues([issue(3)]);
    await f.run((s) => s.configure({ revision: -1, concurrency: 1, allowance: -1, paused: false }));
    await f.run((s) => s.tick(base));
    const c = f.statuses.get(3);
    if (c?.kind !== 'job') throw new Error('Missing C job');
    const ready = {
      ...c,
      delivery: { stage: 'ci' as const, commit: base, ready: true, landed: false },
    };
    f.statuses.set(3, ready);
    f.setIssues([{ ...issue(5), blockers: [3, 4], blockersReady: false, joinRequired: true }]);
    await f.run((s) => s.tick(base));
    expect(f.launches).toEqual([3]);
    f.statuses.set(3, { ...ready, delivery: { ...ready.delivery, ready: false } });
    f.onReconcile(() => {
      f.statuses.set(3, ready);
      f.prepareSucceeds();
    });
    await f.run((s) => s.tick(base));
    expect(f.launches).toEqual([3, 5]);
    expect(f.snapshot().admissions.map((item) => item.issue)).toEqual([3, 5]);
  } finally {
    await f.runtime.dispose();
  }
});

it('counts conflict recovery against concurrency and releases parked or verified recovery without another admission', async () => {
  const f = fixture();
  try {
    const scheduler = await f.runtime.runPromise(Scheduler);
    f.setRecoveries([
      {
        issue: 4,
        pr: 'https://github.com/rafaeltab/wallpaperdb/pull/104',
        progress: 'Awaiting CI',
        active: true,
      },
    ]);
    expect(await f.runtime.runPromise(scheduler.start({ issue: 1, base, context: '' }))).toEqual({
      kind: 'occupied',
    });
    await f.runtime.runPromise(scheduler.tick(base));
    expect(f.launches).toEqual([]);
    f.setRecoveries([
      {
        issue: 4,
        pr: 'https://github.com/rafaeltab/wallpaperdb/pull/104',
        progress: 'Question in T3',
        active: false,
      },
    ]);
    await f.runtime.runPromise(scheduler.start({ issue: 1, base, context: '' }));
    expect(f.launches).toEqual([1]);
    expect(
      (await f.runtime.runPromise(scheduler.status())).state.admissions.map((a) => a.issue)
    ).toEqual([1]);
  } finally {
    await f.runtime.dispose();
  }
});

it.each([-1, 1, 2])(
  'does not recursively observe an admitted repair while deciding recovery capacity, concurrency=%s',
  async (concurrency) => {
    const store = controlledScheduleStore();
    const admitted = { issue: 2, base, context: 'Retained repair' };
    const busy: Status = {
      kind: 'job',
      intent: {
        ...admitted,
        id: 'B',
        branch: 'B',
        issueUrl: issue(2).url,
        createdAt: 0,
        expectedStage: 'implementation',
      },
      execution: { kind: 'absent' },
      elapsedMs: 0,
    };
    let admission: import('../src/capabilities/job/index.js').RecoveryAdmission | undefined;
    let depth = 0;
    let maximumDepth = 0;
    const decisions: boolean[] = [];
    const job: Job = {
      retry: () => Effect.die('Unexpected fresh retry in this fixture'),
      status: () =>
        Effect.gen(function* () {
          depth++;
          maximumDepth = Math.max(maximumDepth, depth);
          // Bound the adverse recursion rather than waiting for the test deadline.
          expect(depth).toBeLessThan(3);
          if (admission) yield* admission(4);
          depth--;
          return busy;
        }),
      start: () => Effect.die('Existing admission must not launch again'),
      resume: () => Effect.succeed({ kind: 'rejected' as const }),
      cancel: () => Effect.succeed({ kind: 'rejected' as const }),
    };
    const runtime = ManagedRuntime.make(
      SchedulerLive.pipe(
        Layer.provide(controlledPlanningSafetyLayer),
        Layer.provide(Layer.succeed(Time, { now: () => Effect.succeed(0) })),
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(ScheduleStore, store),
            Layer.succeed(JobPool, { job: () => Effect.succeed(job) }),
            Layer.succeed(Issues, {
              inspect: () => Effect.die('Recovery must not discover new issues'),
              pullRequest: () => Effect.succeed({ kind: 'absent' as const }),
              recoveries: () => Effect.succeed([]),
              reconcile: (authorize) =>
                Effect.gen(function* () {
                  if (!authorize) throw new Error('Missing recovery authorization');
                  admission = authorize;
                  decisions.push(yield* authorize(4));
                  admission = undefined;
                }),
            }),
            Layer.succeed(Plan, { preview: () => Effect.die('Paused admissions must not plan') }),
            Layer.succeed(PlanningSource, {
              verify: () => Effect.succeed(undefined),
              read: () => Effect.die('Paused admissions must not discover'),
            })
          )
        )
      )
    );
    try {
      await Effect.runPromise(
        store.save({ revision: 0, concurrency, allowance: 1, paused: true, admissions: [admitted] })
      );
      const scheduler = await runtime.runPromise(Scheduler);
      await runtime.runPromise(scheduler.tick(base));
      await runtime.runPromise(scheduler.tick(base));
      expect(maximumDepth).toBe(1);
      expect(decisions).toEqual([concurrency !== 1, concurrency !== 1]);
      expect((await runtime.runPromise(scheduler.status())).state.admissions).toEqual([admitted]);
    } finally {
      await runtime.dispose();
    }
  }
);

it('publishes completed recovery facts before failing planner discovery without admitting work', async () => {
  const f = fixture();
  try {
    f.setRecoveries([
      {
        issue: 4,
        pr: 'https://github.com/rafaeltab/wallpaperdb/pull/104',
        progress: 'Awaiting answer',
        active: false,
        question: 'Approved scope?',
        threadId: 'restacker',
      },
    ]);
    f.failDiscovery();
    await expect(f.run((scheduler) => scheduler.tick(base))).rejects.toMatchObject({
      _tag: 'Unavailable',
      operation: 'controlled-discovery',
    });
    expect(f.published.at(-1)).toMatchObject({
      recoveries: [{ issue: 4, question: 'Approved scope?', active: false }],
    });
    expect(f.launches).toEqual([]);
    expect(f.snapshot().admissions).toEqual([]);
  } finally {
    await f.runtime.dispose();
  }
});

it('does not admit work when completed observation publication fails', async () => {
  const f = fixture();
  try {
    f.failPublication();
    await expect(f.run((scheduler) => scheduler.tick(base))).rejects.toMatchObject({
      _tag: 'Unavailable',
      operation: 'controlled-publication',
    });
    expect(f.launches).toEqual([]);
    expect(f.snapshot().admissions).toEqual([]);
  } finally {
    await f.runtime.dispose();
  }
});

it('does not pass the preflight discovery clock as a model deadline', async () => {
  const { vi } = await import('vitest');
  let now = 1000;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  const f = fixture({
    read: () => {
      now += 30000;
    },
    propose: (deadline) => {
      expect(deadline).toBeUndefined();
    },
  });
  try {
    const scheduler = await f.runtime.runPromise(Scheduler);
    await f.runtime.runPromise(
      scheduler.configure({ revision: 0, concurrency: 1, allowance: 1, paused: false })
    );
    await f.runtime.runPromise(scheduler.tick(base));
  } finally {
    clock.mockRestore();
    await f.runtime.dispose();
  }
});

it('retains the accepted batch through restart and preparation without another planner call', async () => {
  let plans = 0;
  const f = fixture({
    read: () => {},
    propose: () => {
      plans++;
    },
  });
  f.setIssues([{ ...issue(5), blockersReady: false, joinRequired: true }]);
  try {
    await f.run((s) => s.tick(base));
    expect(f.snapshot().cycle?.selected?.map((s) => s.issue)).toEqual([5]);
    await f.reopen();
    f.prepareSucceeds();
    await f.run((s) => s.tick(base));
    expect(plans).toBe(1);
    expect(f.launches).toEqual([5]);
    expect(f.snapshot().cycle).toBeUndefined();
  } finally {
    await f.runtime.dispose();
  }
});

it('does not let a concurrent cycle or manual start consume a batch slot during planning', async () => {
  const entered = await Effect.runPromise(Deferred.make<void>());
  const release = await Effect.runPromise(Deferred.make<void>());
  let plans = 0;
  const f = fixture({
    read: () => {},
    propose: () => {
      plans++;
    },
  });
  f.gatePlan(
    Effect.gen(function* () {
      yield* Deferred.succeed(entered, undefined);
      yield* Deferred.await(release);
    })
  );
  try {
    await f.run((s) => s.configure({ revision: -1, concurrency: 2, allowance: 2, paused: false }));
    const first = f.run((s) => s.tick(base));
    await Effect.runPromise(Deferred.await(entered));
    const competing = f.run((s) => s.tick(base));
    const manual = f.run((s) => s.start({ issue: 3, base, context: '' }));
    expect(plans).toBe(1);
    expect(f.launches).toEqual([]);
    await Effect.runPromise(Deferred.succeed(release, undefined));
    await Promise.all([first, competing]);
    expect(await manual).toMatchObject({ kind: 'occupied' });
    expect(f.launches).toEqual([1, 2]);
    expect(plans).toBe(1);
  } finally {
    await Effect.runPromise(Deferred.succeed(release, undefined));
    await f.runtime.dispose();
  }
});
it('retries local selection persistence across restart without buying another model plan', async () => {
  let plans = 0;
  const f = fixture({
    read: () => {},
    propose: () => {
      plans++;
    },
  });
  try {
    f.failSelectedPersistence(true);
    await expect(f.run((s) => s.tick(base))).rejects.toMatchObject({
      operation: 'controlled-selection-persistence',
    });
    expect(f.launches).toEqual([]);
    await f.reopen();
    f.failSelectedPersistence(false);
    await f.run((s) => s.tick(base));
    expect(plans).toBe(1);
    expect(f.launches).toEqual([1]);
  } finally {
    await f.runtime.dispose();
  }
});
it('uses the owned preparation reservation at concurrency one and automatically launches its selection', async () => {
  const f = fixture();
  f.setIssues([{ ...issue(5), blockersReady: false, joinRequired: true }]);
  f.prepareSucceeds();
  try {
    await f.run((s) => s.tick(base));
    expect(f.preparationDecisions).toEqual([true]);
    expect(f.launches).toEqual([5]);
    expect(f.snapshot().admissions).toHaveLength(1);
  } finally {
    await f.runtime.dispose();
  }
});

it('keeps recovery authorization reserved until an active owning journal is observed', async () => {
  const f = fixture();
  try {
    f.setRecoveries([
      {
        issue: 42,
        pr: 'https://github.com/rafaeltab/wallpaperdb/pull/42',
        active: false,
        progress: 'Waiting for capacity',
      },
    ]);
    expect(await f.run((s) => s.authorizeRecovery(42))).toBe(true);
    await f.run((s) => s.tick(base));
    expect(f.launches).toEqual([]);
    expect(f.snapshot().recovering).toEqual([42]);
    f.setRecoveries([
      {
        issue: 42,
        pr: 'https://github.com/rafaeltab/wallpaperdb/pull/42',
        active: true,
        progress: 'Running',
      },
    ]);
    await f.run((s) => s.status());
    expect(f.snapshot().recovering).toEqual([]);
    await f.run((s) => s.tick(base));
    expect(f.launches).toEqual([]);
    f.setRecoveries([
      {
        issue: 42,
        pr: 'https://github.com/rafaeltab/wallpaperdb/pull/42',
        active: false,
        progress: 'Complete',
      },
    ]);
    await f.run((s) => s.tick(base));
    expect(f.launches).toEqual([1]);
  } finally {
    await f.runtime.dispose();
  }
});

it('automatically replans a retained selection when its issue title changes the authorized task', async () => {
  let plans = 0;
  const f = fixture({
    read: () => {},
    propose: () => {
      plans++;
    },
  });
  f.setIssues([{ ...issue(5), blockersReady: false, joinRequired: true }]);
  try {
    await f.run((s) => s.tick(base));
    f.setIssues([
      { ...issue(5), title: 'Changed authorized task', blockersReady: false, joinRequired: true },
    ]);
    f.prepareSucceeds();
    await f.run((s) => s.tick(base));
    expect(f.launches).toEqual([]);
    await f.run((s) => s.tick(base));
    expect(plans).toBe(2);
    expect(f.launches).toEqual([5]);
  } finally {
    await f.runtime.dispose();
  }
});

it('keeps an interrupted cycle exclusive while its model result awaits local persistence', async () => {
  let plans = 0;
  const f = fixture({
    read: () => {},
    propose: () => {
      plans++;
    },
  });
  try {
    f.failSelectedPersistence(true);
    await expect(f.run((s) => s.tick(base))).rejects.toMatchObject({
      operation: 'controlled-selection-persistence',
    });
    expect(await f.run((s) => s.start({ issue: 3, base, context: '' }))).toMatchObject({
      kind: 'occupied',
    });
    expect(await f.run((s) => s.authorizeRecovery(42))).toBe(false);
    expect(f.launches).toEqual([]);
    f.failSelectedPersistence(false);
    await f.run((s) => s.tick(base));
    expect(plans).toBe(1);
    expect(f.launches).toEqual([1]);
  } finally {
    await f.runtime.dispose();
  }
});
