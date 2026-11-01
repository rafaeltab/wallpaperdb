import { Effect, Layer, ManagedRuntime } from 'effect';
import { expect, it } from 'vitest';
import {
  Scheduler,
  SchedulerLive,
  PlanLive,
  PlanningSource,
  IPlanner,
  ScheduleStore,
  JobPool,
  type PlanningInput,
} from '../src/capabilities/plan/index.js';
import {
  Job,
  JobLive,
  JobStore,
  Issues,
  Time,
  Execution,
  Unavailable,
  type Observation,
} from '../src/capabilities/job/index.js';
import { controlledStore } from './fixtures/store.js';
import { controlledScheduleStore } from './fixtures/schedule-store.js';
const base = 'a'.repeat(40);
function setup(lostSend = true, immediate = false) {
  const schedule = controlledScheduleStore();
  const workers = new Map<number, ManagedRuntime.ManagedRuntime<Job, never>>();
  const stores = new Map<number, JobStore>();
  const observations = new Map<number, Partial<Extract<Observation, { kind: 'found' }>>>();
  const launches: number[] = [];
  let sends = 0;
  const issues: Issues = {
    inspect: (n) =>
      Effect.succeed({
        open: true,
        author: 'rafaeltab',
        labels: ['ready-for-agent'],
        blockers: [],
        blockersReady: true,
        url: `https://github.com/rafaeltab/wallpaperdb/issues/${n}`,
      }),
    pullRequest: () => Effect.succeed({ kind: 'absent' }),
  };
  const pool: JobPool = {
    job: (number) =>
      Effect.promise(async () => {
        let worker = workers.get(number);
        if (!worker) {
          let store = stores.get(number);
          if (!store) {
            store = controlledStore();
            stores.set(number, store);
          }
          worker = ManagedRuntime.make(
            JobLive.pipe(
              Layer.provide(
                Layer.mergeAll(
                  Layer.succeed(JobStore, store),
                  Layer.succeed(Issues, issues),
                  Layer.succeed(Time, { now: () => Effect.succeed(100) }),
                  Layer.succeed(Execution, {
                    launch: () =>
                      Effect.sync(() => {
                        launches.push(number);
                        return { kind: 'submitted' as const };
                      }),
                    interrupt: () => Effect.void,
                    observe: (intent) =>
                      Effect.sync(() => ({
                        kind: 'found' as const,
                        threadId: `thread-${number}`,
                        status: 'running',
                        worktree: '/worker',
                        branch: intent.branch,
                        model: 'gpt-6.1-sol',
                        run: { id: 'run-1', ordinal: 1 },
                        ...observations.get(number),
                      })),
                    inspectStage: () => Effect.succeed(null),
                    sendStage: () =>
                      Effect.gen(function* () {
                        sends++;
                        if (immediate)
                          observations.set(number, {
                            status: 'running',
                            run: { id: 'run-2', ordinal: 2 },
                          });
                        if (lostSend)
                          return yield* Effect.fail(
                            new Unavailable({ operation: 'lost-send', cause: null })
                          );
                      }),
                  })
                )
              )
            )
          );
          workers.set(number, worker);
        }
        return worker.runPromise(Job);
      }),
  };
  const source: PlanningSource = {
    read: () =>
      Effect.gen(function* () {
        const state = yield* schedule.read();
        const jobs = [];
        for (const admission of state.admissions)
          jobs.push(yield* (yield* pool.job(admission.issue)).status());
        const input: PlanningInput = {
          issues: [1, 2].map((number) => ({
            number,
            url: `https://github.com/rafaeltab/wallpaperdb/issues/${number}`,
            title: 'Slice',
            body: 'Requirements',
            author: 'rafaeltab',
            open: true,
            labels: ['ready-for-agent'],
            comments: [],
            blockers: [],
            parents: [],
            blockersReady: true,
            prerequisiteEvidence: '',
          })),
          job: { kind: 'empty' },
          jobs,
          scheduleRevision: state.revision,
          admissions: state.admissions.map((a) => a.issue),
          capacity: { concurrency: state.concurrency, admission: state.allowance },
          paused: state.paused,
        };
        return input;
      }),
  };
  const deps = Layer.mergeAll(
    Layer.succeed(Issues, issues),
    Layer.succeed(ScheduleStore, schedule),
    Layer.succeed(JobPool, pool),
    Layer.succeed(PlanningSource, source),
    Layer.succeed(IPlanner, {
      propose: () =>
        Effect.succeed({
          selected: [{ issue: 2, reason: 'Independent thin slice', dependsOn: [], conflicts: [] }],
          deferred: [],
        }),
    })
  );
  const create = () =>
    ManagedRuntime.make(
      SchedulerLive.pipe(
        Layer.provideMerge(PlanLive.pipe(Layer.provide(deps))),
        Layer.provide(deps)
      )
    );
  let runtime = create();
  const dispose = async () => {
    await runtime.dispose();
    await Promise.all([...workers.values()].map((worker) => worker.dispose()));
    workers.clear();
  };
  return {
    observations,
    launches,
    sends: () => sends,
    run: <A>(f: (scheduler: Scheduler) => Effect.Effect<A, Unavailable>) =>
      runtime.runPromise(Effect.flatMap(Scheduler, f)),
    restart: async () => {
      await dispose();
      runtime = create();
    },
    close: dispose,
  };
}
async function uncertainResume(f: ReturnType<typeof setup>) {
  await f.run((s) => s.configure({ revision: -1, concurrency: 1, allowance: -1, paused: false }));
  f.observations.set(1, { status: 'waiting-for-input', question: { id: 'q1', text: 'Choose?' } });
  const first = await f.run((s) => s.start({ issue: 1, base, context: '' }));
  if (first.kind !== 'job') throw new Error('Missing first job');
  f.observations.set(1, { status: 'completed' });
  await expect(
    f.run((s) => s.resume({ jobId: first.intent.id, index: 0, questionId: 'q1' }))
  ).rejects.toMatchObject({ _tag: 'Unavailable' });
  return first;
}
it.each([2, 3])(
  'reconciles an uncertain resumed continuation at ordinal %s across restart and releases its slot for a new question',
  async (ordinal) => {
    const f = setup();
    try {
      await uncertainResume(f);
      await f.restart();
      f.observations.set(1, { status: 'running', run: { id: `run-${ordinal}`, ordinal } });
      expect((await f.run((s) => s.tick(base))).jobs[0]).toMatchObject({
        delivery: { active: true },
      });
      f.observations.set(1, {
        status: 'waiting-for-input',
        run: { id: `run-${ordinal}`, ordinal },
        question: { id: 'q2', text: 'Choose again?' },
      });
      await f.run((s) => s.tick(base));
      expect(f.launches).toEqual([1, 2]);
      expect(f.sends()).toBe(1);
      expect((await f.run((s) => s.status())).jobs[0]).toMatchObject({
        delivery: { active: false, question: { id: 'q2' } },
      });
    } finally {
      await f.close();
    }
  }
);
it('keeps an unresolved send pending when the original run remains parked', async () => {
  const f = setup();
  try {
    await uncertainResume(f);
    await f.restart();
    f.observations.set(1, { status: 'waiting-for-input', question: { id: 'q1', text: 'Choose?' } });
    await f.run((s) => s.tick(base));
    expect(f.launches).toEqual([1]);
    expect(f.sends()).toBe(1);
  } finally {
    await f.close();
  }
});

it('holds acknowledged resume capacity until the expected continuation becomes observable', async () => {
  const f = setup(false);
  try {
    await f.run((s) => s.configure({ revision: -1, concurrency: 1, allowance: -1, paused: false }));
    f.observations.set(1, { status: 'waiting-for-input', question: { id: 'q1', text: 'Choose?' } });
    const first = await f.run((s) => s.start({ issue: 1, base, context: '' }));
    if (first.kind !== 'job') throw new Error('Missing first job');
    f.observations.set(1, { status: 'completed' });
    expect(
      await f.run((s) => s.resume({ jobId: first.intent.id, index: 0, questionId: 'q1' }))
    ).toMatchObject({ kind: 'job' });
    f.observations.set(1, { status: 'waiting-for-input', question: { id: 'q1', text: 'Choose?' } });
    await f.run((s) => s.tick(base));
    expect(f.launches).toEqual([1]);
    f.observations.set(1, {
      status: 'waiting-for-input',
      run: { id: 'run-2', ordinal: 2 },
      question: { id: 'q2', text: 'Next question?' },
    });
    await f.run((s) => s.tick(base));
    expect(f.launches).toEqual([1, 2]);
    expect(f.sends()).toBe(1);
  } finally {
    await f.close();
  }
});

it('releases a known successful resume claim and keeps subsequent parked work from holding capacity', async () => {
  const f = setup(false, true);
  try {
    await f.run((s) => s.configure({ revision: -1, concurrency: 1, allowance: -1, paused: false }));
    f.observations.set(1, { status: 'waiting-for-input', question: { id: 'q1', text: 'Choose?' } });
    const first = await f.run((s) => s.start({ issue: 1, base, context: '' }));
    if (first.kind !== 'job') throw new Error('Missing job');
    f.observations.set(1, { status: 'completed' });
    expect(
      await f.run((s) => s.resume({ jobId: first.intent.id, index: 0, questionId: 'q1' }))
    ).toMatchObject({ kind: 'job', delivery: { active: true } });
    expect((await f.run((s) => s.status())).state.resuming).toEqual([]);
    f.observations.set(1, {
      status: 'waiting-for-input',
      run: { id: 'run-2', ordinal: 2 },
      question: { id: 'q2', text: 'Next?' },
    });
    await f.run((s) => s.tick(base));
    expect(f.launches).toEqual([1, 2]);
    expect(f.sends()).toBe(1);
  } finally {
    await f.close();
  }
});
it('rejects a stale resume command without retaining capacity or charging a new admission', async () => {
  const f = setup();
  try {
    await f.run((s) => s.configure({ revision: -1, concurrency: 1, allowance: -1, paused: false }));
    f.observations.set(1, { status: 'waiting-for-input', question: { id: 'q1', text: 'Choose?' } });
    const first = await f.run((s) => s.start({ issue: 1, base, context: '' }));
    if (first.kind !== 'job') throw new Error('Missing job');
    expect(
      await f.run((s) => s.resume({ jobId: first.intent.id, index: 999, questionId: 'obsolete' }))
    ).toEqual({ kind: 'rejected' });
    await f.run((s) => s.tick(base));
    expect(f.launches).toEqual([1, 2]);
    expect(f.sends()).toBe(0);
  } finally {
    await f.close();
  }
});
