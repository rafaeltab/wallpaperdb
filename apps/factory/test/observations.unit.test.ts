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
  let value: ObservationState = {};
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
          Layer.succeed(ObservationStore, {
            read: () => Effect.succeed(value),
            refresh: (state) =>
              Effect.sync(() => {
                value = { ...value, ...state };
              }),
            jobs: () => Effect.void,
          }),
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
    job: { status: unavailable, start: unavailable, resume: unavailable, cancel: unavailable },
    scheduler: {
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
  } finally {
    await runtime.dispose();
  }
});

it('keeps snapshots responsive during a blocked independent refresh', async () => {
  let value: ObservationState = {};
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
          Layer.succeed(ObservationStore, {
            read: () => Effect.succeed(value),
            refresh: (update) =>
              Effect.sync(() => {
                value = { ...value, ...update };
              }),
            jobs: () => Effect.void,
          }),
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
