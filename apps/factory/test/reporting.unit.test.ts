import { Effect, Layer, ManagedRuntime } from 'effect';
import { TestClock } from 'effect/testing';
import { expect, it } from 'vitest';
import {
  Reporting,
  ReportingLive,
  ReportingStore,
  type IssueObservation,
} from '../src/capabilities/observe/index.js';
import { controlledObservations } from './fixtures/observations.js';

const issue: IssueObservation = {
  number: 1,
  url: 'https://github.com/rafaeltab/wallpaperdb/issues/1',
  title: 'First',
  open: true,
  candidate: true,
  labels: [],
  assignees: [],
  projectStatus: null,
  projectPriority: null,
  projectSize: null,
  commentCount: 0,
  blockers: [],
  parents: [],
  pullRequests: [],
};
function setup() {
  const store = controlledObservations();
  const runtime = ManagedRuntime.make(
    ReportingLive.pipe(
      Layer.provide(Layer.succeed(ReportingStore, store)),
      Layer.provideMerge(TestClock.layer())
    )
  );
  return { store, runtime };
}
it('coalesces an item without postponing the fixed publication deadline under continuous arrivals', async () => {
  const { store, runtime } = setup();
  try {
    const reporting = await runtime.runPromise(Reporting);
    const generation = await runtime.runPromise(reporting.begin());
    await runtime.runPromise(
      reporting.enqueue(generation, [{ kind: 'issue', value: issue, sequence: 1, at: 10 }])
    );
    await runtime.runPromise(TestClock.adjust(900));
    await runtime.runPromise(
      reporting.enqueue(generation, [
        { kind: 'issue', value: { ...issue, title: 'Latest' }, sequence: 2, at: 20 },
      ])
    );
    expect((await Effect.runPromise(store.read())).facts).toBeUndefined();
    await runtime.runPromise(TestClock.adjust(100));
    expect(await Effect.runPromise(store.read())).toMatchObject({
      facts: { issues: [{ title: 'Latest' }] },
      items: { 'issue:1': { observedAt: 20 } },
    });
  } finally {
    await runtime.dispose();
  }
});
it.each([
  {
    scenario: 'stale run',
    firstStage: 1,
    firstRun: 8,
    nextStage: 1,
    nextRun: 7,
    expectedStage: 1,
    expectedRun: 8,
    expectedId: 'first',
    expectedAt: 10,
  },
  {
    scenario: 'increasing run',
    firstStage: 1,
    firstRun: 7,
    nextStage: 1,
    nextRun: 8,
    expectedStage: 1,
    expectedRun: 8,
    expectedId: 'next',
    expectedAt: 20,
  },
  {
    scenario: 'same ordinal replacement',
    firstStage: 1,
    firstRun: 8,
    nextStage: 1,
    nextRun: 8,
    expectedStage: 1,
    expectedRun: 8,
    expectedId: 'next',
    expectedAt: 20,
  },
  {
    scenario: 'stale stage',
    firstStage: 2,
    firstRun: 1,
    nextStage: 1,
    nextRun: 8,
    expectedStage: 2,
    expectedRun: 1,
    expectedId: 'first',
    expectedAt: 10,
  },
  {
    scenario: 'later stage',
    firstStage: 1,
    firstRun: 8,
    nextStage: 2,
    nextRun: 1,
    expectedStage: 2,
    expectedRun: 1,
    expectedId: 'next',
    expectedAt: 20,
  },
])(
  'coalesces the newest eligible buffered job for $scenario',
  async ({
    firstStage,
    firstRun,
    nextStage,
    nextRun,
    expectedStage,
    expectedRun,
    expectedId,
    expectedAt,
  }) => {
    const { store, runtime } = setup();
    const intent = {
      id: 'job-one',
      issue: 1,
      issueUrl: issue.url,
      base: 'a'.repeat(40),
      branch: 'worker',
      context: '',
      createdAt: 0,
      expectedStage: 'implementation' as const,
    };
    const job = (stageIndex: number, ordinal: number, id: string) => ({
      kind: 'job' as const,
      intent,
      stageIndex,
      elapsedMs: 0,
      execution: {
        kind: 'found' as const,
        threadId: 'thread',
        status: 'running',
        worktree: '/worker',
        branch: intent.branch,
        model: 'gpt-6.1-sol',
        run: { id, ordinal },
      },
    });
    try {
      const reporting = await runtime.runPromise(Reporting);
      const first = await runtime.runPromise(reporting.begin());
      await runtime.runPromise(
        reporting.enqueue(first, [
          { kind: 'job', value: job(firstStage, firstRun, 'first'), sequence: 1, at: 10 },
        ])
      );
      const next = await runtime.runPromise(reporting.begin());
      await runtime.runPromise(
        reporting.enqueue(next, [
          { kind: 'job', value: job(nextStage, nextRun, 'next'), sequence: 1, at: 20 },
        ])
      );
      await runtime.runPromise(TestClock.adjust(1000));
      expect(await Effect.runPromise(store.read())).toMatchObject({
        jobs: [
          {
            stageIndex: expectedStage,
            execution: { run: { id: expectedId, ordinal: expectedRun } },
          },
        ],
        items: { 'job:job-one': { observedAt: expectedAt } },
      });
    } finally {
      await runtime.dispose();
    }
  }
);

it('bypasses buffering for acknowledgements and flushes completed pending observations at shutdown', async () => {
  const { store, runtime } = setup();
  const reporting = await runtime.runPromise(Reporting);
  const generation = await runtime.runPromise(reporting.begin());
  await runtime.runPromise(
    reporting.enqueue(generation, [{ kind: 'issue', value: issue, sequence: 1, at: 10 }])
  );
  await runtime.runPromise(
    reporting.immediate(generation, [
      { kind: 'failure', key: 'job:one', error: 'uncertain', sequence: 2, at: 20 },
    ])
  );
  expect((await Effect.runPromise(store.read())).items?.['job:one']?.error).toBe('uncertain');
  await runtime.dispose();
  expect((await Effect.runPromise(store.read())).facts?.issues).toEqual([issue]);
});
it('flushes at the buffer limit without discarding unrelated items', async () => {
  const { store, runtime } = setup();
  try {
    const reporting = await runtime.runPromise(Reporting);
    const generation = await runtime.runPromise(reporting.begin());
    await runtime.runPromise(
      reporting.enqueue(
        generation,
        Array.from({ length: 100 }, (_, index) => ({
          kind: 'issue' as const,
          value: { ...issue, number: index + 1 },
          sequence: index,
          at: 10,
        }))
      )
    );
    expect((await Effect.runPromise(store.read())).facts?.issues).toHaveLength(100);
  } finally {
    await runtime.dispose();
  }
});

it.each(['submitted', 'uncertain'] as const)(
  'publishes only an acknowledged %s launch while execution observation is blocked',
  async (outcome) => {
    const { Job, JobLive, JobStore, Execution, Issues, Time } = await import(
      '../src/capabilities/job/index.js'
    );
    const { JobReportingLive } = await import('../src/capabilities/observe/index.js');
    const { controlledStore } = await import('./fixtures/store.js');
    const store = controlledObservations();
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let launches = 0;
    const time = Layer.succeed(Time, { now: () => Effect.succeed(100) });
    const reportingLayer = ReportingLive.pipe(Layer.provide(Layer.succeed(ReportingStore, store)));
    const runtime = ManagedRuntime.make(
      JobLive.pipe(
        Layer.provide(
          Layer.mergeAll(
            JobReportingLive.pipe(Layer.provide(reportingLayer), Layer.provide(time)),
            time,
            Layer.succeed(JobStore, controlledStore()),
            Layer.succeed(Issues, {
              inspect: () =>
                Effect.succeed({
                  open: true,
                  author: 'rafaeltab',
                  labels: ['ready-for-agent'],
                  blockers: [],
                  blockersReady: true,
                  url: issue.url,
                }),
              pullRequest: () => Effect.succeed({ kind: 'absent' as const }),
            }),
            Layer.succeed(Execution, {
              launch: () =>
                Effect.sync(() => {
                  launches++;
                  return { kind: outcome };
                }),
              interrupt: () => Effect.void,
              sendStage: () => Effect.void,
              inspectStage: () => Effect.succeed(null),
              observe: () =>
                Effect.promise(async () => {
                  started();
                  await gate;
                  return { kind: 'ambiguous' as const };
                }),
            })
          )
        )
      )
    );
    const job = await runtime.runPromise(Job);
    const pending = runtime.runPromise(job.start({ issue: 1, base: 'a'.repeat(40), context: '' }));
    try {
      await entered;
      const retained = await Effect.runPromise(store.read());
      if (outcome === 'submitted')
        expect(retained.jobs).toMatchObject([
          {
            acknowledgement: { stage: 'implementation', acceptedAt: 100 },
            execution: { kind: 'ambiguous' },
            delivery: { ready: false, landed: false },
          },
        ]);
      else expect(retained.jobs).toBeUndefined();
      expect(launches).toBe(1);
    } finally {
      release();
      await pending;
      await runtime.dispose();
    }
  }
);

it.each(['submitted', 'uncertain'] as const)(
  'keeps %s fresh retry and later stage acceptance on the retained job identity',
  async (outcome) => {
    const { Job, JobLive, JobStore, Execution, Issues, Time } = await import(
      '../src/capabilities/job/index.js'
    );
    const { JobReportingLive } = await import('../src/capabilities/observe/index.js');
    const { controlledStore } = await import('./fixtures/store.js');
    const jobs = controlledStore();
    const store = controlledObservations();
    const intent = {
      id: 'retained-job',
      issue: 1,
      issueUrl: issue.url,
      base: 'a'.repeat(40),
      branch: 'worker',
      context: '',
      createdAt: 0,
      expectedStage: 'implementation' as const,
      receiptProtocol: 'delivery-v1' as const,
    };
    await Effect.runPromise(jobs.reserve(intent));
    await Effect.runPromise(
      jobs.saveStage({
        index: 0,
        stage: 'implementation',
        threadId: 'original',
        commit: intent.base,
        previousRunId: null,
        receiptProtocol: 'delivery-v1',
      })
    );
    let retried = false;
    let successful = false;
    let run = 0;
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const providerIds: string[] = [];
    const time = Layer.succeed(Time, { now: () => Effect.succeed(100) });
    const reporting = ReportingLive.pipe(Layer.provide(Layer.succeed(ReportingStore, store)));
    const runtime = ManagedRuntime.make(
      JobLive.pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            reporting,
            JobReportingLive.pipe(Layer.provide(reporting), Layer.provide(time)),
            time,
            Layer.succeed(JobStore, jobs),
            Layer.succeed(Issues, {
              inspect: () =>
                Effect.succeed({
                  open: true,
                  author: 'rafaeltab',
                  labels: ['ready-for-agent'],
                  blockers: [],
                  blockersReady: true,
                  url: issue.url,
                }),
              pullRequest: () => Effect.succeed({ kind: 'absent' as const }),
            }),
            Layer.succeed(Execution, {
              launch: (active) =>
                Effect.sync(() => {
                  providerIds.push(active.id);
                  retried = true;
                  return { kind: outcome };
                }),
              interrupt: () => Effect.void,
              sendStage: (active) =>
                Effect.sync(() => {
                  providerIds.push(active.id);
                  run++;
                }),
              observe: (active) =>
                Effect.promise(async () => {
                  if (retried) {
                    entered();
                    await gate;
                  }
                  return {
                    kind: 'found' as const,
                    threadId: retried ? 'retry' : 'original',
                    worktree: '/controlled',
                    branch: active.branch,
                    model: 'gpt-6.1-sol',
                    status: successful ? ('completed' as const) : ('failed' as const),
                    run: { id: `run-${run}`, ordinal: run + 1 },
                  };
                }),
              inspectStage: (_active, request) =>
                Effect.succeed({
                  stageIndex: request.index,
                  runId: `run-${run}`,
                  ordinal: run + 1,
                  commit: 'b'.repeat(40),
                  accepted: successful,
                }),
            })
          )
        )
      )
    );
    try {
      const job = await runtime.runPromise(Job);
      const publication = await runtime.runPromise(Reporting);
      const before = await runtime.runPromise(job.status());
      if (before.kind !== 'job' || !before.retry) throw new Error('Missing supported retry');
      await runtime.runPromise(publication.flush());
      const pending = runtime.runPromise(job.retry({ ...before.retry, jobId: intent.id }));
      try {
        await blocked;
        const retained = await Effect.runPromise(store.read());
        expect(retained.jobs).toHaveLength(1);
        expect(retained.jobs?.[0]).toMatchObject({ intent: { id: intent.id } });
        if (outcome === 'submitted') {
          expect(retained.jobs?.[0]).toMatchObject({
            intent: { branch: 'worker-retry-1' },
            acknowledgement: { stage: 'implementation', index: 1, acceptedAt: 100 },
            execution: { kind: 'ambiguous' },
            delivery: { active: true, ready: false, landed: false },
          });
        } else {
          expect(
            retained.jobs?.[0]?.kind === 'job' && retained.jobs[0].acknowledgement
          ).toBeUndefined();
        }
        expect(providerIds).toEqual(['retained-job:retry-1']);
      } finally {
        release();
        await pending;
      }
      successful = true;
      for (const [stage, index] of [
        ['review', 2],
        ['publication', 3],
      ] as const) {
        await runtime.runPromise(job.status());
        const retained = await Effect.runPromise(store.read());
        expect(retained.jobs).toHaveLength(1);
        expect(retained.jobs?.[0]).toMatchObject({
          intent: { id: intent.id, branch: 'worker-retry-1' },
          acknowledgement: { stage, index, acceptedAt: 100 },
          delivery: { stage, ready: false, landed: false },
        });
      }
      expect(providerIds).toEqual(Array(3).fill('retained-job:retry-1'));
    } finally {
      await runtime.dispose();
    }
  }
);

it('publishes a complete issue while another observation is blocked and preserves it when the collection fails', async () => {
  const { Observations, ObservationsLive, ObservationStore, ObservationSource, LocalSnapshot } =
    await import('../src/capabilities/observe/index.js');
  const { Time, Unavailable } = await import('../src/capabilities/job/index.js');
  const store = controlledObservations();
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const runtime = ManagedRuntime.make(
    ObservationsLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          ReportingLive.pipe(Layer.provide(Layer.succeed(ReportingStore, store))),
          Layer.succeed(ObservationStore, store),
          Layer.succeed(Time, { now: () => Effect.succeed(20) }),
          Layer.succeed(LocalSnapshot, {
            read: () =>
              Effect.succeed({
                state: { revision: 0, concurrency: 1, allowance: 1, paused: true, admissions: [] },
                entries: [],
              }),
          }),
          Layer.succeed(ObservationSource, {
            read: (publish) =>
              Effect.gen(function* () {
                if (publish) yield* publish({ kind: 'issue', value: issue });
                yield* Effect.promise(async () => {
                  entered();
                  await gate;
                });
                return yield* Effect.fail(
                  new Unavailable({ operation: 'second-issue-offline', cause: null })
                );
              }),
          })
        )
      ),
      Layer.provideMerge(TestClock.layer())
    )
  );
  const observations = await runtime.runPromise(Observations);
  const pending = runtime.runPromise(observations.refresh());
  try {
    await started;
    await runtime.runPromise(TestClock.adjust(1000));
    expect(await runtime.runPromise(observations.snapshot())).toMatchObject({
      facts: { issues: [issue] },
      items: { 'issue:1': { observedAt: 20 } },
    });
    expect((await runtime.runPromise(observations.snapshot())).observedAt).toBeUndefined();
    release();
    await pending;
    expect(await runtime.runPromise(observations.snapshot())).toMatchObject({
      facts: { issues: [issue] },
      error: 'second-issue-offline',
    });
    expect((await runtime.runPromise(observations.snapshot())).observedAt).toBeUndefined();
  } finally {
    release();
    await pending;
    await runtime.dispose();
  }
});

it('keeps the buffer bounded while persistence is unavailable and retains the admitted complete observations', async () => {
  const { Unavailable } = await import('../src/capabilities/job/index.js');
  const store = controlledObservations();
  let offline = true;
  const runtime = ManagedRuntime.make(
    ReportingLive.pipe(
      Layer.provide(
        Layer.succeed(ReportingStore, {
          begin: store.begin,
          publish: (generation, items) =>
            offline
              ? Effect.fail(new Unavailable({ operation: 'offline', cause: null }))
              : store.publish(generation, items),
        })
      )
    )
  );
  try {
    const reporting = await runtime.runPromise(Reporting);
    const generation = await runtime.runPromise(reporting.begin());
    await expect(
      runtime.runPromise(
        reporting.enqueue(
          generation,
          Array.from({ length: 100 }, (_, index) => ({
            kind: 'issue' as const,
            value: { ...issue, number: index + 1 },
            sequence: index,
            at: 10,
          }))
        )
      )
    ).rejects.toMatchObject({ operation: 'offline' });
    await expect(
      runtime.runPromise(
        reporting.enqueue(generation, [
          { kind: 'issue', value: { ...issue, number: 101 }, sequence: 101, at: 20 },
        ])
      )
    ).rejects.toMatchObject({ operation: 'offline' });
    offline = false;
    await runtime.runPromise(reporting.flush());
    expect((await Effect.runPromise(store.read())).facts?.issues).toHaveLength(100);
  } finally {
    offline = false;
    await runtime.dispose();
  }
});

it('commits observations from independent collections in one bounded batch without replacing their ordering', async () => {
  const store = controlledObservations();
  let committed = 0;
  const runtime = ManagedRuntime.make(
    ReportingLive.pipe(
      Layer.provide(
        Layer.succeed(ReportingStore, {
          begin: store.begin,
          publish: (generation, items) =>
            Effect.gen(function* () {
              committed++;
              yield* store.publish(generation, items);
            }),
        })
      )
    )
  );
  try {
    const reporting = await runtime.runPromise(Reporting);
    const first = await runtime.runPromise(reporting.begin());
    const second = await runtime.runPromise(reporting.begin());
    await runtime.runPromise(
      reporting.enqueue(first, [{ kind: 'issue', value: issue, sequence: 1, at: 10 }])
    );
    await runtime.runPromise(
      reporting.enqueue(second, [
        { kind: 'issue', value: { ...issue, number: 2 }, sequence: 1, at: 20 },
      ])
    );
    await runtime.runPromise(reporting.flush());
    expect(committed).toBe(1);
    expect((await Effect.runPromise(store.read())).items).toMatchObject({
      'issue:1': { generation: first },
      'issue:2': { generation: second },
    });
  } finally {
    await runtime.dispose();
  }
});

it.each([false, true])(
  'captures stage reporting at construction and preserves uncertain delivery responsibility: %s',
  async (uncertain) => {
    const { Job, JobLive, JobStore, JobReporting, Execution, Issues, Time, Unavailable } =
      await import('../src/capabilities/job/index.js');
    const { controlledStore } = await import('./fixtures/store.js');
    const accepted: string[] = [];
    let stage = 0,
      sends = 0;
    const runtime = ManagedRuntime.make(
      JobLive.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(Time, { now: () => Effect.succeed(100) }),
            Layer.succeed(JobStore, controlledStore()),
            Layer.succeed(JobReporting, {
              begin: () => Effect.succeed(1),
              observed: () => Effect.void,
              failed: () => Effect.void,
              accepted: (_intent, next) =>
                Effect.sync(() => {
                  accepted.push(next);
                }),
            }),
            Layer.succeed(Issues, {
              inspect: () =>
                Effect.succeed({
                  open: true,
                  author: 'rafaeltab',
                  labels: ['ready-for-agent'],
                  blockers: [],
                  blockersReady: true,
                  url: issue.url,
                }),
              pullRequest: () => Effect.succeed({ kind: 'absent' as const }),
            }),
            Layer.succeed(Execution, {
              launch: () => Effect.succeed({ kind: 'submitted' as const }),
              interrupt: () => Effect.void,
              observe: (intent) =>
                Effect.succeed({
                  kind: 'found' as const,
                  threadId: 'thread',
                  worktree: '/worker',
                  branch: intent.branch,
                  model: 'gpt-6.1-sol',
                  status: 'completed',
                  run: { id: `run-${stage + 1}`, ordinal: stage + 1 },
                }),
              inspectStage: (_intent, request) =>
                Effect.succeed({
                  stageIndex: request.index,
                  runId: `run-${stage + 1}`,
                  ordinal: stage + 1,
                  commit: 'b'.repeat(40),
                  accepted: true,
                }),
              sendStage: (_intent, request) =>
                Effect.gen(function* () {
                  sends++;
                  if (uncertain)
                    return yield* Effect.fail(
                      new Unavailable({ operation: 'delivery-uncertain', cause: null })
                    );
                  stage = request.index;
                }),
            })
          )
        )
      )
    );
    try {
      const job = await runtime.runPromise(Job);
      const start = runtime.runPromise(job.start({ issue: 1, base: 'a'.repeat(40), context: '' }));
      if (uncertain) {
        await expect(start).rejects.toMatchObject({ operation: 'delivery-uncertain' });
        await runtime.runPromise(job.status());
        expect(accepted).toEqual(['implementation']);
        expect(sends).toBe(1);
      } else {
        await start;
        expect(accepted).toEqual(['implementation', 'review']);
        await runtime.runPromise(job.status());
        expect(accepted).toEqual(['implementation', 'review', 'publication']);
      }
    } finally {
      await runtime.dispose();
    }
  }
);

it('preserves publication timing when a newer running observation precedes failed receipt inspection', async () => {
  const { Job, JobLive, JobStore, Execution, Issues, Time, Unavailable } = await import(
    '../src/capabilities/job/index.js'
  );
  const { JobReportingLive } = await import('../src/capabilities/observe/index.js');
  const { controlledStore } = await import('./fixtures/store.js');
  const jobs = controlledStore();
  const observations = controlledObservations();
  const intent = {
    id: 'publishing-owner',
    issue: 1,
    issueUrl: issue.url,
    base: 'a'.repeat(40),
    branch: 'worker',
    context: '',
    createdAt: 0,
    expectedStage: 'implementation' as const,
  };
  await Effect.runPromise(jobs.reserve(intent));
  await Effect.runPromise(
    jobs.saveStage({
      index: 0,
      stage: 'publication',
      threadId: 'owner',
      commit: intent.base,
      previousRunId: null,
      publicationStartedAt: 2000,
    })
  );
  let fail = false;
  let ordinal = 1;
  const time = Layer.succeed(Time, { now: () => Effect.succeed(65000) });
  const reporting = ReportingLive.pipe(Layer.provide(Layer.succeed(ReportingStore, observations)));
  const runtime = ManagedRuntime.make(
    JobLive.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          reporting,
          JobReportingLive.pipe(Layer.provide(reporting), Layer.provide(time)),
          time,
          Layer.succeed(JobStore, jobs),
          Layer.succeed(Issues, {
            inspect: () => Effect.die('No issue inspection expected'),
            pullRequest: () => Effect.succeed({ kind: 'absent' as const }),
          }),
          Layer.succeed(Execution, {
            launch: () => Effect.die('No launch expected'),
            interrupt: () => Effect.void,
            sendStage: () => Effect.die('No delivery expected'),
            observe: () =>
              Effect.succeed({
                kind: 'found' as const,
                threadId: 'owner',
                status: 'running',
                run: { id: `run-${ordinal}`, ordinal },
                worktree: '/worker',
                branch: intent.branch,
                model: 'controlled',
              }),
            inspectStage: () =>
              fail
                ? Effect.fail(new Unavailable({ operation: 'inspection-outage', cause: null }))
                : Effect.succeed(null),
          })
        )
      )
    )
  );
  try {
    const job = await runtime.runPromise(Job);
    await runtime.runPromise(job.status());
    await runtime.runPromise(Effect.flatMap(Reporting, (r) => r.flush()));
    expect((await Effect.runPromise(observations.read())).jobs?.[0]).toMatchObject({
      publicationStartedAt: 2000,
    });
    fail = true;
    ordinal = 2;
    await expect(runtime.runPromise(job.status())).rejects.toMatchObject({
      operation: 'inspection-outage',
    });
    await runtime.runPromise(Effect.flatMap(Reporting, (r) => r.flush()));
    expect((await Effect.runPromise(observations.read())).jobs?.[0]).toMatchObject({
      publicationStartedAt: 2000,
      execution: { kind: 'found', run: { id: 'run-2' } },
    });
  } finally {
    await runtime.dispose();
  }
});
