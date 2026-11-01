import { Effect, Layer, ManagedRuntime } from 'effect';
import { expect, it } from 'vitest';
import {
  PlanLive,
  PlanningSource,
  IPlanner,
  Scheduler,
  SchedulerLive,
  ScheduleStore,
  JobPool,
  type PlanningIssue,
} from '../src/capabilities/plan/index.js';
import { Issues, type Job, type Status } from '../src/capabilities/job/index.js';
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
function fixture() {
  const store = controlledScheduleStore();
  const snapshot = () => Effect.runSync(store.read());
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
  let issues = [1, 2, 3, 4].map(issue);
  const source = {
    read: () =>
      Effect.sync(() => ({
        issues,
        job: { kind: 'empty' as const },
        jobs: [...statuses.values()],
        scheduleRevision: snapshot().revision,
        admissions: snapshot().admissions.map((a) => a.issue),
        paused: snapshot().paused,
        capacity: { concurrency: snapshot().concurrency, admission: snapshot().allowance },
      })),
  };
  const deps = Layer.mergeAll(
    Layer.succeed(Issues, {
      inspect: (number) =>
        Effect.sync(() => {
          const candidate = issues.find((i) => i.number === number);
          return {
            open: candidate?.open ?? false,
            author: candidate?.author ?? '',
            labels: candidate?.labels ?? [],
            blockers: candidate?.blockers ?? [],
            blockersReady: candidate?.blockersReady ?? false,
            url: issue(number).url,
          };
        }),
      pullRequest: () => Effect.succeed({ kind: 'absent' as const }),
    }),
    Layer.succeed(ScheduleStore, store),
    Layer.succeed(JobPool, pool),
    Layer.succeed(PlanningSource, source),
    Layer.succeed(IPlanner, {
      propose: () =>
        Effect.sync(() => {
          duringPlan?.();
          return {
            selected: issues.map((i) => ({
              issue: i.number,
              reason: 'Thin user-facing slice',
              dependsOn: [],
              conflicts: [],
            })),
            deferred: [],
          };
        }),
    })
  );
  const runtime = ManagedRuntime.make(
    SchedulerLive.pipe(Layer.provideMerge(PlanLive.pipe(Layer.provide(deps))), Layer.provide(deps))
  );
  return {
    runtime,
    statuses,
    launches,
    resumed,
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

it('refills a completed slot while two other jobs continue and retains CI waits', async () => {
  const f = fixture();
  try {
    await f.run((s) => s.configure({ revision: -1, concurrency: 3, allowance: -1, paused: false }));
    await f.run((s) => s.tick(base));
    expect(f.launches).toEqual([1, 2, 3]);
    const first = f.statuses.get(1);
    if (first?.kind !== 'job') throw new Error('Missing first job');
    f.statuses.set(1, {
      ...first,
      delivery: { stage: 'ci', commit: base, ready: true, landed: false },
    });
    await f.run((s) => s.tick(base));
    expect(f.launches).toEqual([1, 2, 3, 4]);
  } finally {
    await f.runtime.dispose();
  }
});
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
    f.setIssues([issue(1), { ...issue(2), blockers: [1] }, issue(3)]);
    await f.run((s) => s.tick(base));
    expect(f.launches).toEqual([1, 3]);
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
    f.setIssues([issue(1), { ...issue(2), blockers: [1] }, issue(3)]);
    expect(await f.run((s) => s.start({ issue: 2, base, context: '' }))).toEqual({
      kind: 'rejected',
    });
    expect(f.launches).toEqual([1]);
    expect(await f.run((s) => s.start({ issue: 3, base, context: '' }))).toMatchObject({
      kind: 'job',
    });
    expect(f.launches).toEqual([1, 3]);
  } finally {
    await f.runtime.dispose();
  }
});
