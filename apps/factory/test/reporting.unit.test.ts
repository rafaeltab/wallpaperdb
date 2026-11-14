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
