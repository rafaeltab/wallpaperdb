import { Effect, Layer, ManagedRuntime } from 'effect';
import { expect, it } from 'vitest';
import { Time, Unavailable } from '../src/capabilities/job/index.js';
import {
  LocalSnapshot,
  ObservationStore,
  Threads,
  ThreadsLive,
  ThreadSource,
  ThreadStore,
  type ThreadState,
} from '../src/capabilities/observe/index.js';
it('keeps last-known thread metadata dated on failure and never calls T3 from reads', async () => {
  let state: ThreadState = {};
  let now = 100;
  let calls = 0;
  const runtime = ManagedRuntime.make(
    ThreadsLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(LocalSnapshot, {
            read: () =>
              Effect.succeed({
                state: { revision: 0, concurrency: 1, allowance: 0, paused: true, admissions: [] },
                entries: [],
              }),
          }),
          Layer.succeed(ObservationStore, {
            read: () => Effect.succeed({}),
            refresh: () => Effect.void,
            jobs: () => Effect.void,
          }),
          Layer.succeed(Time, { now: () => Effect.succeed(now) }),
          Layer.succeed(ThreadStore, {
            read: () => Effect.succeed(state),
            save: (value) =>
              Effect.sync(() => {
                state = value;
              }),
          }),
          Layer.succeed(ThreadSource, {
            read: () => {
              calls++;
              return calls === 1
                ? Effect.succeed({
                    environmentId: 'env',
                    projectId: 'project',
                    threads: [
                      {
                        threadId: 't',
                        title: 'Issue #648 is only a title',
                        createdAt: null,
                        updatedAt: null,
                        status: 'running',
                        branch: null,
                        worktree: null,
                        pullRequests: [],
                      },
                    ],
                  })
                : Effect.fail(new Unavailable({ operation: 't3-metadata', cause: 'secret' }));
            },
          })
        )
      )
    )
  );
  try {
    const service = await runtime.runPromise(Threads);
    expect((await runtime.runPromise(service.snapshot())).state).toBe('initial');
    await runtime.runPromise(service.refresh());
    expect(await runtime.runPromise(service.snapshot())).toMatchObject({
      state: 'current',
      observedAt: 100,
      facts: { environmentId: 'env' },
    });
    now = 300_000;
    await runtime.runPromise(service.refresh());
    expect(await runtime.runPromise(service.snapshot())).toMatchObject({
      state: 'error',
      stale: true,
      observedAt: 100,
      failedAt: 300_000,
      error: 't3-metadata',
      facts: { threads: [{ threadId: 't' }] },
    });
    expect(calls).toBe(2);
  } finally {
    await runtime.dispose();
  }
});

it('uses explicit PR evidence, leaves title-only issues absent, and does not invent branch ownership', async () => {
  let state: ThreadState = {
    observedAt: 10,
    facts: {
      environmentId: 'env',
      projectId: 'project',
      threads: [
        {
          threadId: 't',
          title: 'Implement #999',
          createdAt: null,
          updatedAt: null,
          status: 'completed',
          branch: null,
          worktree: null,
          pullRequests: [
            {
              repository: 'rafaeltab/wallpaperdb',
              number: 672,
              url: 'https://github.com/rafaeltab/wallpaperdb/pull/672',
            },
          ],
        },
        {
          threadId: 'unbound',
          title: 'Implement #648',
          createdAt: null,
          updatedAt: null,
          status: 'running',
          branch: null,
          worktree: null,
          pullRequests: [],
        },
      ],
    },
  };
  const runtime = ManagedRuntime.make(
    ThreadsLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(Time, { now: () => Effect.succeed(20) }),
          Layer.succeed(LocalSnapshot, {
            read: () =>
              Effect.succeed({
                state: { revision: 0, concurrency: 1, allowance: 0, paused: true, admissions: [] },
                entries: [],
              }),
          }),
          Layer.succeed(ObservationStore, {
            read: () =>
              Effect.succeed({
                observedAt: 12,
                facts: {
                  issues: [],
                  pullRequests: [
                    {
                      number: 672,
                      url: 'https://github.com/rafaeltab/wallpaperdb/pull/672',
                      state: 'OPEN',
                      head: 'a',
                      headBranch: 'b',
                      base: 'c',
                      baseBranch: 'main',
                      linkedIssues: [648],
                      crossReferencedIssues: [999],
                      review: 'UNKNOWN',
                      ci: 'UNKNOWN',
                      evidenceHead: 'a',
                    },
                  ],
                },
              }),
            refresh: () => Effect.void,
            jobs: () => Effect.void,
          }),
          Layer.succeed(ThreadStore, {
            read: () => Effect.succeed(state),
            save: (value) =>
              Effect.sync(() => {
                state = value;
              }),
          }),
          Layer.succeed(ThreadSource, {
            read: () => (state.facts ? Effect.succeed(state.facts) : Effect.die('Missing fixture')),
          })
        )
      )
    )
  );
  try {
    const service = await runtime.runPromise(Threads);
    await runtime.runPromise(service.refresh());
    const facts = (await runtime.runPromise(service.snapshot())).facts;
    expect(facts?.threads[0]).toMatchObject({
      branch: null,
      worktree: null,
      associationState: 'evidenced',
      associations: [{ issue: 648, evidence: 'github-closing-reference', observedAt: 12 }],
    });
    expect(facts?.threads[1]).toMatchObject({ associationState: 'absent', associations: [] });
  } finally {
    await runtime.dispose();
  }
});

it('retains loading data during a slow refresh and reports conflicting durable bindings without changing ownership', async () => {
  const intent = {
    id: 'job',
    issue: 648,
    issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/648',
    base: 'a'.repeat(40),
    context: '',
    branch: 'factory/648',
    createdAt: 0,
    expectedStage: 'implementation' as const,
  };
  const execution = {
    kind: 'found' as const,
    threadId: 'thread',
    status: 'running',
    branch: 'factory/648',
    worktree: '/bound',
    model: 'gpt-6.1-sol',
  };
  let entries = [{ intent, control: { revision: 0, cancelled: false, claimed: [] } }];
  let jobs = [{ kind: 'job' as const, intent, execution, elapsedMs: 0 }];
  let state: ThreadState = {};
  let now = 100;
  let release: (() => void) | undefined;
  let blocked = false;
  const runtime = ManagedRuntime.make(
    ThreadsLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(Time, { now: () => Effect.succeed(now) }),
          Layer.succeed(LocalSnapshot, {
            read: () =>
              Effect.succeed({
                state: { revision: 0, concurrency: 1, allowance: 1, paused: true, admissions: [] },
                entries,
              }),
          }),
          Layer.succeed(ObservationStore, {
            read: () => Effect.succeed({ jobs }),
            refresh: () => Effect.void,
            jobs: () => Effect.void,
          }),
          Layer.succeed(ThreadStore, {
            read: () => Effect.succeed(state),
            save: (value) =>
              Effect.sync(() => {
                state = value;
              }),
          }),
          Layer.succeed(ThreadSource, {
            read: () =>
              Effect.tryPromise({
                try: async () => {
                  if (blocked)
                    await new Promise<void>((resolve) => {
                      release = resolve;
                    });
                  return {
                    environmentId: 'env',
                    projectId: 'project',
                    threads: [
                      {
                        threadId: 'thread',
                        title: 'title',
                        createdAt: null,
                        updatedAt: null,
                        status: 'running',
                        branch: null,
                        worktree: null,
                        pullRequests: [],
                      },
                    ],
                  };
                },
                catch: (cause) => new Unavailable({ operation: 'offline', cause }),
              }),
          })
        )
      )
    )
  );
  try {
    const service = await runtime.runPromise(Threads);
    await runtime.runPromise(service.refresh());
    expect(state.facts?.threads[0]).toMatchObject({
      branch: 'factory/648',
      worktree: '/bound',
      associationState: 'evidenced',
      associations: [{ issue: 648, evidence: 'factory-binding' }],
    });
    now = 200;
    blocked = true;
    const refreshing = runtime.runPromise(service.refresh());
    await expect.poll(() => !!release).toBe(true);
    expect(await runtime.runPromise(service.snapshot())).toMatchObject({
      state: 'loading',
      observedAt: 100,
    });
    entries = [
      ...entries,
      {
        intent: { ...intent, id: 'other', issue: 649 },
        control: { revision: 0, cancelled: false, claimed: [] },
      },
    ];
    jobs = [
      ...jobs,
      { kind: 'job', intent: { ...intent, id: 'other', issue: 649 }, execution, elapsedMs: 0 },
    ];
    release?.();
    await refreshing;
    expect(state.facts?.threads[0]).toMatchObject({
      branch: null,
      worktree: null,
      associationState: 'conflicting',
    });
    expect(entries[0]?.intent.id).toBe('job');
    now = 300_000;
    expect(await runtime.runPromise(service.snapshot())).toMatchObject({
      state: 'stale',
      stale: true,
      observedAt: 200,
    });
  } finally {
    release?.();
    await runtime.dispose();
  }
});
