import { controlledObservations } from './fixtures/observations.js';
import { observationStoreContract } from './fixtures/observation-contract.js';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { expect, it } from 'vitest';
import { Time, Unavailable } from '../src/capabilities/job/index.js';
import {
  Observations,
  ObservationsLive,
  ObservationSource,
  ObservationStore,
  LocalSnapshot,
  type ObservationState,
} from '../src/capabilities/observe/index.js';
import { operationsServer } from '../src/http/index.js';
it('serves all snapshots locally while GitHub and workflow reconciliation are unavailable', async () => {
  const store = controlledObservations();
  let revision = 3;
  const runtime = ManagedRuntime.make(
    ObservationsLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(Time, { now: () => Effect.succeed(100) }),
          Layer.succeed(LocalSnapshot, {
            read: () =>
              Effect.succeed({
                state: { revision, concurrency: 1, allowance: 1, paused: true, admissions: [] },
                entries: [],
              }),
          }),
          Layer.succeed(ObservationStore, store),
          Layer.succeed(ObservationSource, {
            read: () =>
              Effect.fail(new Unavailable({ operation: 'offline', cause: 'unavailable' })),
          })
        )
      )
    )
  );
  const observer = await runtime.runPromise(Observations);
  let externalCalls = 0;
  const unavailable = () =>
    Effect.sync(() => {
      externalCalls++;
      throw new Error('External work on HTTP read');
    });
  const app = operationsServer({
    base: 'a'.repeat(40),
    snapshot: observer.schedule,
    run: (e) => runtime.runPromise(e),
    job: {
      retry: () => Effect.die('Unexpected fresh retry in this fixture'),
      status: unavailable,
      start: unavailable,
      resume: unavailable,
      cancel: unavailable,
    },
    scheduler: {
      retry: () => Effect.die('Unexpected fresh retry in this fixture'),
      status: unavailable,
      configure: () =>
        Effect.sync(() => {
          revision++;
          return 'saved' as const;
        }),
      tick: unavailable,
      start: unavailable,
      resume: unavailable,
      cancel: unavailable,
      authorizeRecovery: unavailable,
    },
  });
  try {
    expect((await runtime.runPromise(observer.snapshot())).state).toBe('initial');
    await runtime.runPromise(observer.refresh());
    expect(await runtime.runPromise(observer.snapshot())).toMatchObject({
      state: 'error',
      failedAt: 100,
      error: 'offline',
    });
    for (const url of ['/', '/api/job', '/api/scheduler', '/api/observations']) {
      const response = await app.inject({ url });
      expect(response.statusCode).toBe(200);
    }
    const response = await app.inject({
      method: 'POST',
      url: '/api/scheduler',
      payload: { revision: 3, concurrency: 1, allowance: 1, paused: true },
    });
    expect(response.json().state.revision).toBe(4);
    expect(externalCalls).toBe(0);
  } finally {
    await app.close();
    await runtime.dispose();
  }
});

it('retains current local controls and rejects a cached job with a different identity', async () => {
  const intent = {
    id: 'current',
    issue: 1,
    issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/1',
    base: 'a'.repeat(40),
    context: '',
    branch: 'worker',
    createdAt: 10,
    expectedStage: 'implementation' as const,
  };
  const retained: ObservationState = {
    jobs: [
      {
        kind: 'job',
        intent: { ...intent, id: 'old' },
        execution: {
          kind: 'found',
          threadId: 'wrong',
          status: 'running',
          worktree: '/old',
          branch: 'old',
          model: 'model',
        },
        elapsedMs: 0,
      },
    ],
    jobsObservedAt: 20,
  };
  const runtime = ManagedRuntime.make(
    ObservationsLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(Time, { now: () => Effect.succeed(30) }),
          Layer.succeed(LocalSnapshot, {
            read: () =>
              Effect.succeed({
                state: {
                  revision: 8,
                  concurrency: 1,
                  allowance: 1,
                  paused: true,
                  admissions: [{ issue: 1, base: intent.base, context: '' }],
                },
                entries: [{ intent, control: { revision: 4, cancelled: true, claimed: [] } }],
              }),
          }),
          Layer.succeed(ObservationStore, {
            read: () => Effect.succeed(retained),
            refresh: () => Effect.void,
            jobs: () => Effect.void,
          }),
          Layer.succeed(ObservationSource, { read: () => Effect.die('Snapshot must not refresh') })
        )
      )
    )
  );
  try {
    const observer = await runtime.runPromise(Observations);
    expect(await runtime.runPromise(observer.schedule())).toMatchObject({
      state: { revision: 8 },
      jobs: [{ intent: { id: 'current' }, execution: { kind: 'ambiguous' }, elapsedMs: 20 }],
      localWork: [{ control: { revision: 4, cancelled: true } }],
    });
    retained.jobs = [
      {
        kind: 'job',
        intent,
        execution: { kind: 'ambiguous' },
        elapsedMs: 0,
        resume: { index: 1, runId: 'old', revision: 3 },
        prerequisite: {
          url: 'https://github.com/rafaeltab/wallpaperdb/pull/42',
          commit: intent.base,
        },
        delivery: { stage: 'ci', commit: intent.base, ready: true, landed: false, active: true },
      },
    ];
    const cancelled = await runtime.runPromise(observer.schedule());
    expect(cancelled.jobs).toMatchObject([
      {
        delivery: { activity: 'cancelled', active: false, ready: false },
        resume: undefined,
        prerequisite: undefined,
      },
    ]);
  } finally {
    await runtime.dispose();
  }
});

it('keeps snapshots responsive during a blocked independent refresh', async () => {
  const store = controlledObservations();
  let release!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const runtime = ManagedRuntime.make(
    ObservationsLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(Time, { now: () => Effect.succeed(10) }),
          Layer.succeed(LocalSnapshot, {
            read: () =>
              Effect.succeed({
                state: { revision: 0, concurrency: 1, allowance: 1, paused: true, admissions: [] },
                entries: [],
              }),
          }),
          Layer.succeed(ObservationStore, store),
          Layer.succeed(ObservationSource, {
            read: () =>
              Effect.promise(async () => {
                started();
                await gate;
                return { issues: [], pullRequests: [] };
              }),
          })
        )
      )
    )
  );
  const observer = await runtime.runPromise(Observations);
  const refreshing = runtime.runPromise(observer.refresh());
  try {
    await waiting;
    expect((await runtime.runPromise(observer.snapshot())).state).toBe('loading');
    expect((await runtime.runPromise(observer.schedule())).state.revision).toBe(0);
  } finally {
    release();
    await refreshing;
    await runtime.dispose();
  }
});

observationStoreContract('controlled observations', async () => ({
  store: controlledObservations(),
  close: async () => undefined,
}));

it('dates last-known facts consistently with the conservative refresh cadence and clears errors on recovery', async () => {
  const store = controlledObservations();
  let now = 10;
  const runtime = ManagedRuntime.make(
    ObservationsLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(Time, { now: () => Effect.succeed(now) }),
          Layer.succeed(ObservationStore, store),
          Layer.succeed(ObservationSource, { read: () => Effect.die('Snapshot does not refresh') }),
          Layer.succeed(LocalSnapshot, {
            read: () =>
              Effect.succeed({
                state: { revision: 0, concurrency: 1, allowance: 1, paused: true, admissions: [] },
                entries: [],
              }),
          })
        )
      )
    )
  );
  try {
    const observer = await runtime.runPromise(Observations);
    await Effect.runPromise(
      store.refresh({ startedAt: 5, observedAt: 10, facts: { issues: [], pullRequests: [] } })
    );
    now = 120010;
    expect(await runtime.runPromise(observer.snapshot())).toMatchObject({
      state: 'current',
      ageMs: 120000,
      stale: false,
    });
    now = 240011;
    expect(await runtime.runPromise(observer.snapshot())).toMatchObject({
      state: 'stale',
      ageMs: 240001,
      stale: true,
    });
    await Effect.runPromise(store.refresh({ startedAt: now }));
    expect(await runtime.runPromise(observer.snapshot())).toMatchObject({
      state: 'loading',
      stale: true,
      observedAt: 10,
    });
    await Effect.runPromise(store.refresh({ startedAt: now, failedAt: now, error: 'offline' }));
    expect(await runtime.runPromise(observer.snapshot())).toMatchObject({
      state: 'error',
      stale: true,
      observedAt: 10,
    });
    now++;
    await Effect.runPromise(
      store.refresh({ startedAt: now, observedAt: now, facts: { issues: [], pullRequests: [] } })
    );
    expect(await runtime.runPromise(observer.snapshot())).toMatchObject({
      state: 'current',
      stale: false,
      ageMs: 0,
      error: undefined,
    });
  } finally {
    await runtime.dispose();
  }
});

const resumeCases: readonly {
  name: string;
  action: import('../src/capabilities/job/index.js').ResumeAction;
  parked?: import('../src/capabilities/job/index.js').Control['parked'];
  cancelled?: boolean;
  expected: boolean;
}[] = [
  {
    name: 'current retry revision',
    action: { index: 2, runId: 'run', revision: 4 },
    expected: true,
  },
  {
    name: 'stale retry revision',
    action: { index: 2, runId: 'run', revision: 3 },
    expected: false,
  },
  {
    name: 'matching parked question',
    action: { index: 2, questionId: 'q' },
    parked: { index: 2, question: { id: 'q', text: 'Scope?' } },
    expected: true,
  },
  {
    name: 'different parked question',
    action: { index: 2, questionId: 'old' },
    parked: { index: 2, question: { id: 'q', text: 'Scope?' } },
    expected: false,
  },
  {
    name: 'different parked stage',
    action: { index: 1, questionId: 'q' },
    parked: { index: 2, question: { id: 'q', text: 'Scope?' } },
    expected: false,
  },
  { name: 'cleared parked question', action: { index: 2, questionId: 'q' }, expected: false },
  {
    name: 'cancelled current retry',
    action: { index: 2, runId: 'run', revision: 4 },
    cancelled: true,
    expected: false,
  },
];
it.each(resumeCases)(
  'projects resume eligibility for $name from current local controls',
  async ({ action, parked, cancelled, expected }) => {
    const intent = {
      id: 'current',
      issue: 1,
      issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/1',
      base: 'a'.repeat(40),
      context: '',
      branch: 'worker',
      createdAt: 10,
      expectedStage: 'implementation' as const,
    };
    const store = controlledObservations({
      jobs: [
        { kind: 'job', intent, execution: { kind: 'ambiguous' }, elapsedMs: 0, resume: action },
      ],
    });
    const runtime = ManagedRuntime.make(
      ObservationsLive.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(Time, { now: () => Effect.succeed(20) }),
            Layer.succeed(ObservationStore, store),
            Layer.succeed(ObservationSource, {
              read: () => Effect.die('Snapshot does not refresh'),
            }),
            Layer.succeed(LocalSnapshot, {
              read: () =>
                Effect.succeed({
                  state: {
                    revision: 0,
                    concurrency: 1,
                    allowance: 1,
                    paused: true,
                    admissions: [{ issue: 1, base: intent.base, context: '' }],
                  },
                  entries: [
                    {
                      intent,
                      control: { revision: 4, cancelled: cancelled ?? false, claimed: [], parked },
                    },
                  ],
                }),
            })
          )
        )
      )
    );
    try {
      const observer = await runtime.runPromise(Observations);
      expect((await runtime.runPromise(observer.schedule())).jobs).toMatchObject([
        { resume: expected ? action : undefined },
      ]);
    } finally {
      await runtime.dispose();
    }
  }
);
