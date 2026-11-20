import { Clock, Effect, Layer } from 'effect';
import { expect, it } from 'vitest';
import {
  Time,
  Job,
  JobLive,
  JobStore,
  Issues,
  Execution,
  Unavailable,
  JobReporting,
} from '../src/capabilities/job/index.js';
import { controlledStore } from './fixtures/store.js';
it('persists stage intent before launch, keeps uncertainty reserved, and reconciles without relaunch', async () => {
  const store = controlledStore();
  let launches = 0;
  let found = false;
  let unavailable = false;
  let now = 1000;
  let sequence = 0;
  const investigations = new Map<string, { issue: number; startedAt: number }>();
  const dependencies = Layer.mergeAll(
    Layer.succeed(JobReporting, {
      begin: () => Effect.succeed(1),
      accepted: () => Effect.void,
      observed: () => Effect.void,
      failed: () => Effect.void,
      investigating: (intent) =>
        Effect.sync(() => {
          const id = String(++sequence);
          investigations.set(id, { issue: intent.issue, startedAt: now });
          return id;
        }),
      investigated: (id) =>
        Effect.sync(() => {
          investigations.delete(id);
        }),
    }),
    Layer.succeed(Time, { now: () => Clock.currentTimeMillis }),
    Layer.succeed(JobStore, store),
    Layer.succeed(Issues, {
      pullRequest: () => Effect.succeed({ kind: 'absent' as const }),
      inspect: () =>
        Effect.succeed({
          open: true,
          author: 'rafaeltab',
          labels: ['ready-for-agent'],
          blockers: [],
          blockersReady: true,
          url: 'https://github.com/rafaeltab/wallpaperdb/issues/576',
        }),
    }),
    Layer.succeed(Execution, {
      interrupt: () => Effect.void,
      inspectStage: () => Effect.succeed(null),
      sendStage: () => Effect.void,
      launch: () =>
        Effect.flatMap(store.read(), (intent) =>
          Effect.sync(() => {
            expect([...investigations.values()]).toEqual([{ issue: 576, startedAt: 1000 }]);
            expect(intent?.expectedStage).toBe('implementation');
            launches++;
            return { kind: 'uncertain' as const };
          })
        ),
      observe: () =>
        Effect.flatMap(
          Effect.sync(() => {
            expect([...investigations.values()]).toEqual([{ issue: 576, startedAt: now }]);
          }),
          () =>
            unavailable
              ? Effect.fail(new Unavailable({ operation: 'controlled-observation', cause: null }))
              : Effect.flatMap(store.read(), (intent) =>
                  Effect.succeed(
                    found
                      ? {
                          kind: 'found' as const,
                          threadId: 'thread-1',
                          status: 'running',
                          worktree: '/isolated',
                          branch: intent?.branch ?? '',
                          model: 'gpt-6.1-sol',
                        }
                      : { kind: 'absent' as const }
                  )
                )
        ),
    })
  );
  const run = <A, E>(effect: Effect.Effect<A, E, Job>) =>
    Effect.runPromise(effect.pipe(Effect.provide(JobLive.pipe(Layer.provide(dependencies)))));
  expect(
    (
      await run(
        Effect.flatMap(Job, (job) => job.start({ issue: 576, base: 'a'.repeat(40), context: '' }))
      )
    ).kind
  ).toBe('job');
  expect(
    (
      await run(
        Effect.flatMap(Job, (job) => job.start({ issue: 577, base: 'a'.repeat(40), context: '' }))
      )
    ).kind
  ).toBe('occupied');
  await run(Effect.flatMap(Job, (job) => job.status()));
  expect(launches).toBe(1);
  expect(investigations.size).toBe(0);
  now = 2000;
  found = true;
  expect(await run(Effect.flatMap(Job, (job) => job.status()))).toMatchObject({
    kind: 'job',
    execution: { kind: 'found', threadId: 'thread-1' },
  });
  expect(launches).toBe(1);
  expect(investigations.size).toBe(0);
  const retained = await Effect.runPromise(store.read());
  unavailable = true;
  await expect(run(Effect.flatMap(Job, (job) => job.status()))).rejects.toMatchObject({
    operation: 'controlled-observation',
  });
  expect(investigations.size).toBe(0);
  expect(await Effect.runPromise(store.read())).toEqual(retained);
  expect(launches).toBe(1);
});

it.each([false, true])(
  'retains a closed request across unavailable observations, restored adopted question=%s',
  async (adopted) => {
    const store = controlledStore();
    let closed = false;
    let unavailable = false;
    const dependencies = Layer.mergeAll(
      Layer.succeed(Time, { now: () => Effect.succeed(1000) }),
      Layer.succeed(JobStore, store),
      Layer.succeed(Issues, {
        inspect: () =>
          Effect.succeed({
            open: true,
            author: 'rafaeltab',
            labels: ['ready-for-agent'],
            blockers: [],
            blockersReady: true,
            url: 'https://github.com/rafaeltab/wallpaperdb/issues/729',
          }),
        pullRequest: () => Effect.succeed({ kind: 'absent' as const }),
      }),
      Layer.succeed(Execution, {
        launch: () => Effect.succeed({ kind: 'submitted' as const }),
        interrupt: () => Effect.void,
        sendStage: () => Effect.die('Closing a request must not send a continuation'),
        inspectStage: () => Effect.succeed(null),
        observe: (intent) =>
          Effect.succeed(
            unavailable
              ? { kind: 'unverified' as const, threadId: 'thread-729', status: 'unknown' }
              : {
                  kind: 'found' as const,
                  threadId: 'thread-729',
                  status: 'waiting',
                  worktree: '/worker',
                  branch: intent.branch,
                  model: 'gpt-6.1-sol',
                  run: {
                    id: adopted && closed ? 'run-2' : 'run-1',
                    ordinal: adopted && closed ? 2 : 1,
                  },
                  ...(closed
                    ? { closedQuestions: [adopted ? 'q2' : 'q1'] }
                    : { question: { id: 'q1', text: 'Choose?', startedAt: 500 } }),
                }
          ),
      })
    );
    const run = <A, E>(effect: Effect.Effect<A, E, Job>) =>
      Effect.runPromise(effect.pipe(Effect.provide(JobLive.pipe(Layer.provide(dependencies)))));
    await run(
      Effect.flatMap(Job, (job) => job.start({ issue: 729, base: 'a'.repeat(40), context: '' }))
    );
    await run(Effect.flatMap(Job, (job) => job.status()));
    expect((await Effect.runPromise(store.readControl())).parked).toMatchObject({
      question: { id: 'q1' },
    });
    if (adopted)
      await Effect.runPromise(
        store.saveStage({
          index: 1,
          stage: 'implementation',
          threadId: 'thread-729',
          commit: 'a'.repeat(40),
          previousRunId: 'run-1',
          observedRunId: 'run-2',
          ordinal: 2,
          question: { id: 'q2', text: 'Next decision?', startedAt: 700 },
        })
      );
    closed = true;
    await run(Effect.flatMap(Job, (job) => job.status()));
    expect((await Effect.runPromise(store.readControl())).parked).toMatchObject({
      closed: true,
      question: { id: adopted ? 'q2' : 'q1' },
    });
    unavailable = true;
    await run(Effect.flatMap(Job, (job) => job.status()));
    expect((await Effect.runPromise(store.readControl())).parked).toMatchObject({ closed: true });
  }
);

it.each([false, true])(
  'retains a provisional question through metadata failure and unavailable observation, new run=%s',
  async (newRun) => {
    const store = controlledStore();
    const intent = {
      id: 'provisional-729',
      issue: 729,
      issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/729',
      branch: 'worker',
      base: 'a'.repeat(40),
      context: '',
      createdAt: 0,
      expectedStage: 'implementation' as const,
    };
    await Effect.runPromise(store.reserve(intent));
    await Effect.runPromise(
      store.saveStage({
        index: 0,
        stage: 'publication',
        threadId: 'thread-729',
        commit: intent.base,
        previousRunId: null,
      })
    );
    let replacement = false;
    let unavailable = false;
    let closed = false;
    let stale = false;
    let noQuestionOrdinal: number | undefined;
    let staleOrdinal = 1;
    const baseOrdinal = newRun ? 10 : 1;
    const reports: import('../src/capabilities/job/index.js').Status[] = [];
    const deps = Layer.mergeAll(
      Layer.succeed(JobStore, store),
      Layer.succeed(JobReporting, {
        begin: () => Effect.succeed(1),
        accepted: () => Effect.void,
        failed: () => Effect.void,
        observed: (_generation, value) =>
          Effect.sync(() => {
            reports.push(value);
          }),
      }),
      Layer.succeed(Time, { now: () => Effect.succeed(3000) }),
      Layer.succeed(Issues, {
        inspect: () => Effect.die('No new admission'),
        pullRequest: () =>
          replacement && !unavailable && !closed
            ? Effect.fail(
                new Unavailable({ operation: 'controlled-metadata', cause: 'injected failure' })
              )
            : Effect.succeed({ kind: 'absent' as const }),
      }),
      Layer.succeed(Execution, {
        launch: () => Effect.die('No new launch'),
        interrupt: () => Effect.void,
        sendStage: () => Effect.die('No continuation authority from reporting'),
        inspectStage: () => Effect.succeed(null),
        observe: () =>
          Effect.succeed(
            unavailable
              ? { kind: 'unverified' as const, threadId: 'thread-729', status: 'unknown' }
              : {
                  kind: 'found' as const,
                  threadId: 'thread-729',
                  status: 'waiting-for-input',
                  branch: intent.branch,
                  worktree: '/worker',
                  model: 'gpt-6.1-sol',
                  run: {
                    id: noQuestionOrdinal
                      ? `run-${noQuestionOrdinal}`
                      : stale
                        ? `run-${staleOrdinal}`
                        : `run-${baseOrdinal + (replacement && newRun ? 1 : 0)}`,
                    ordinal:
                      noQuestionOrdinal ??
                      (stale ? staleOrdinal : baseOrdinal + (replacement && newRun ? 1 : 0)),
                  },
                  question: noQuestionOrdinal
                    ? undefined
                    : stale
                      ? { id: 'old-unrelated', text: 'Stale question', startedAt: 500 }
                      : closed
                        ? undefined
                        : replacement
                          ? { id: 'q2', text: 'Replacement decision', startedAt: 2000 }
                          : { id: 'q1', text: 'First decision', startedAt: 1000 },
                  closedQuestions: noQuestionOrdinal
                    ? []
                    : replacement
                      ? closed
                        ? ['q1', 'q2']
                        : ['q1']
                      : [],
                }
          ),
      })
    );
    const run = <A, E>(effect: Effect.Effect<A, E, Job>) =>
      Effect.runPromise(effect.pipe(Effect.provide(JobLive.pipe(Layer.provide(deps)))));
    if (newRun) {
      replacement = true;
      noQuestionOrdinal = 9;
      await run(Effect.exit(Effect.flatMap(Job, (job) => job.status())));
      expect(await Effect.runPromise(store.readControl())).toMatchObject({
        answerWait: { closed: true, run: { id: 'run-9', ordinal: 9 } },
      });
      noQuestionOrdinal = undefined;
      stale = true;
      staleOrdinal = 8;
      const count = reports.length;
      await run(Effect.exit(Effect.flatMap(Job, (job) => job.status())));
      expect(reports[count]).toMatchObject({ execution: { question: undefined } });
      expect(await Effect.runPromise(store.readControl())).toMatchObject({
        answerWait: { closed: true, run: { id: 'run-9', ordinal: 9 } },
      });
      stale = false;
      replacement = false;
    }
    await run(Effect.flatMap(Job, (job) => job.status()));
    replacement = true;
    expect(await run(Effect.exit(Effect.flatMap(Job, (job) => job.status())))).toMatchObject({
      _tag: 'Failure',
    });
    expect(await Effect.runPromise(store.readControl())).toMatchObject({
      answerWait: { question: { id: 'q2', startedAt: 2000 } },
    });
    unavailable = true;
    await run(Effect.flatMap(Job, (job) => job.status()));
    expect(await Effect.runPromise(store.readControl())).toMatchObject({
      answerWait: { question: { id: 'q2', startedAt: 2000 } },
    });
    unavailable = false;
    closed = true;
    await run(Effect.flatMap(Job, (job) => job.status()));
    expect(await Effect.runPromise(store.readControl())).toMatchObject({
      answerWait: { closed: true, question: { id: 'q2' } },
    });
    if (newRun) {
      for (const ordinal of [14, 16]) {
        noQuestionOrdinal = ordinal;
        await run(Effect.flatMap(Job, (job) => job.status()));
        expect(await Effect.runPromise(store.readControl())).toMatchObject({
          answerWait: { closed: true, run: { id: `run-${ordinal}`, ordinal } },
        });
      }
      noQuestionOrdinal = undefined;
      staleOrdinal = 15;
      stale = true;
      const count = reports.length;
      await run(Effect.flatMap(Job, (job) => job.status()));
      expect(reports[count]).toMatchObject({ execution: { kind: 'found', question: undefined } });
      expect(await Effect.runPromise(store.readControl())).toMatchObject({
        answerWait: { closed: true, question: { id: 'q2' } },
      });
    }
  }
);

async function investigationFixture(
  stage: 'implementation' | 'review' | 'publication',
  resume = false
) {
  const { Deferred, ManagedRuntime } = await import('effect');
  const store = controlledStore();
  const intent = {
    id: 'reconciliation-owner',
    issue: 723,
    issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/723',
    branch: 'issue-723',
    base: 'a'.repeat(40),
    context: '',
    createdAt: 0,
    expectedStage: 'implementation' as const,
  };
  await Effect.runPromise(store.reserve(intent));
  await Effect.runPromise(
    store.saveStage({
      index: 0,
      stage: 'implementation',
      threadId: 'thread-723',
      commit: intent.base,
      previousRunId: null,
    })
  );
  await Effect.runPromise(
    store.saveStage({
      index: 1,
      stage,
      threadId: 'thread-723',
      commit: intent.base,
      previousRunId: resume ? 'run-0' : 'run-1',
      ordinal: resume ? 1 : 2,
      resume: true,
      receiptProtocol: 'delivery-v1',
    })
  );
  if (resume)
    await Effect.runPromise(
      store.saveControl({
        revision: 0,
        cancelled: false,
        claimed: [],
        parked: {
          index: 1,
          run: { id: 'run-1', ordinal: 1 },
          question: { id: 'question-1', text: 'Continue?' },
          closed: true,
        },
      })
    );
  const observed = await Effect.runPromise(Deferred.make<void>());
  const observeRelease = await Effect.runPromise(Deferred.make<void>());
  const inspected = await Effect.runPromise(Deferred.make<void>());
  const inspectRelease = await Effect.runPromise(Deferred.make<void>());
  const investigations = new Map<
    string,
    import('../src/capabilities/job/index.js').ExecutionInvestigation
  >();
  let sequence = 0;
  let now = 1000;
  let fail = false;
  let sends = 0;
  const runtime = ManagedRuntime.make(
    JobLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(JobStore, store),
          Layer.succeed(Time, { now: () => Effect.sync(() => now) }),
          Layer.succeed(JobReporting, {
            begin: () => Effect.succeed(1),
            accepted: () => Effect.void,
            observed: () => Effect.void,
            failed: () => Effect.void,
            investigating: (value, responsibility) =>
              Effect.sync(() => {
                const id = `investigation-${++sequence}`;
                investigations.set(id, {
                  id,
                  issue: value.issue,
                  stage: responsibility,
                  startedAt: now,
                });
                return id;
              }),
            investigated: (id) =>
              Effect.sync(() => {
                investigations.delete(id);
              }),
          }),
          Layer.succeed(Issues, {
            inspect: () => Effect.die('No new admission during reconciliation'),
            pullRequest: () => Effect.succeed({ kind: 'absent' }),
          }),
          Layer.succeed(Execution, {
            launch: () => Effect.die('Uncertain effects must not be repeated'),
            interrupt: () => Effect.void,
            sendStage: () =>
              Effect.sync(() => {
                sends++;
              }),
            observe: (_intent, request) =>
              Effect.gen(function* () {
                if (resume && request?.index === 1)
                  return {
                    kind: 'found' as const,
                    threadId: 'thread-723',
                    status: 'completed',
                    branch: intent.branch,
                    worktree: '/worker',
                    model: 'gpt-6.1-sol',
                    run: { id: 'run-1', ordinal: 1 },
                  };
                yield* Deferred.succeed(observed, undefined);
                yield* Deferred.await(observeRelease);
                return {
                  kind: 'found' as const,
                  threadId: 'thread-723',
                  status: 'running',
                  branch: intent.branch,
                  worktree: '/worker',
                  model: 'gpt-6.1-sol',
                  run: { id: 'run-2', ordinal: 2 },
                };
              }),
            inspectStage: () =>
              Effect.gen(function* () {
                yield* Deferred.succeed(inspected, undefined);
                yield* Deferred.await(inspectRelease);
                if (fail)
                  return yield* Effect.fail(
                    new Unavailable({ operation: 'controlled-inspection', cause: null })
                  );
                return null;
              }),
          })
        )
      )
    )
  );
  return {
    intent,
    store,
    runtime,
    facts: () => [...investigations.values()],
    clock: (value: number) => {
      now = value;
    },
    fail: () => {
      fail = true;
    },
    sends: () => sends,
    observed: () => Effect.runPromise(Deferred.await(observed)),
    inspected: () => Effect.runPromise(Deferred.await(inspected)),
    releaseObservation: () => Effect.runPromise(Deferred.succeed(observeRelease, undefined)),
    releaseInspection: () => Effect.runPromise(Deferred.succeed(inspectRelease, undefined)),
    close: async () => {
      await Effect.runPromise(Deferred.succeed(observeRelease, undefined));
      await Effect.runPromise(Deferred.succeed(inspectRelease, undefined));
      await runtime.dispose();
    },
  };
}

it.each(['implementation', 'review', 'publication'] as const)(
  'keeps restored %s reconciliation in its retained responsibility throughout investigation',
  async (stage) => {
    const f = await investigationFixture(stage);
    try {
      const operation = f.runtime.runPromise(Effect.flatMap(Job, (job) => job.status()));
      await f.observed();
      expect(f.facts()).toEqual([{ id: expect.any(String), issue: 723, stage, startedAt: 1000 }]);
      const current = f.facts();
      f.clock(2000);
      await f.releaseObservation();
      await f.inspected();
      expect(f.facts()).toEqual(current);
      await f.releaseInspection();
      expect(await operation).toMatchObject({ kind: 'job', delivery: { stage } });
      expect(f.facts()).toEqual([]);
    } finally {
      await f.close();
    }
  }
);

it.each([false, true])(
  'owns resumed review investigation until settlement, failure=%s',
  async (failure) => {
    const f = await investigationFixture('review', true);
    try {
      if (failure) f.fail();
      const operation = f.runtime
        .runPromise(
          Effect.flatMap(Job, (job) =>
            job.resume({
              jobId: f.intent.id,
              index: 1,
              questionId: 'question-1',
            })
          )
        )
        .then(
          (value) => ({ kind: 'success' as const, value }),
          (error) => ({ kind: 'failure' as const, error })
        );
      await f.observed();
      expect(f.facts()).toEqual([
        { id: expect.any(String), issue: 723, stage: 'review', startedAt: 1000 },
      ]);
      const current = f.facts();
      f.clock(2000);
      await f.releaseObservation();
      await f.inspected();
      expect(f.facts()).toEqual(current);
      await f.releaseInspection();
      const result = await operation;
      if (failure)
        expect(result).toMatchObject({
          kind: 'failure',
          error: { operation: 'controlled-inspection' },
        });
      else
        expect(result).toMatchObject({
          kind: 'success',
          value: { kind: 'job', delivery: { stage: 'review' } },
        });
      expect(f.facts()).toEqual([]);
      expect(f.sends()).toBe(1);
      expect(await Effect.runPromise(f.store.read())).toEqual(f.intent);
      expect((await Effect.runPromise(f.store.readControl())).claimed).toContain(2);
    } finally {
      await f.close();
    }
  }
);

it.each([false, true])(
  'keeps uncertain fresh retries separate from the abandoned attempt, first observation=%s',
  async (firstObservation) => {
    const { Deferred, ManagedRuntime } = await import('effect');
    const { AgentReconciliationPolicy } = await import('../src/capabilities/job/index.js');
    const store = controlledStore();
    const intent = {
      id: 'fresh-retry-owner',
      issue: 723,
      issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/723',
      branch: 'issue-723',
      base: 'a'.repeat(40),
      context: '',
      createdAt: 0,
      expectedStage: 'implementation' as const,
    };
    await Effect.runPromise(store.reserve(intent));
    await Effect.runPromise(
      store.saveStage({
        index: 0,
        stage: 'implementation',
        threadId: 'old-thread',
        commit: intent.base,
        previousRunId: null,
      })
    );
    await Effect.runPromise(
      store.saveStage({
        index: 1,
        stage: 'implementation',
        threadId: 'old-thread',
        commit: intent.base,
        previousRunId: 'run-1',
        ordinal: 2,
        resume: true,
        receiptProtocol: 'delivery-v1',
      })
    );
    const entered = await Effect.runPromise(Deferred.make<void>());
    const release = await Effect.runPromise(Deferred.make<void>());
    const live = new Map<
      string,
      import('../src/capabilities/job/index.js').ExecutionInvestigation
    >();
    let sequence = 0;
    let launches = 0;
    let hold = false;
    const runtime = ManagedRuntime.make(
      JobLive.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(JobStore, store),
            Layer.succeed(AgentReconciliationPolicy, { limit: 0 }),
            Layer.succeed(Time, { now: () => Effect.succeed(1000) }),
            Layer.succeed(JobReporting, {
              begin: () => Effect.succeed(1),
              accepted: () => Effect.void,
              observed: () => Effect.void,
              failed: () => Effect.void,
              investigating: (value, stage) =>
                Effect.sync(() => {
                  const id = `retry-investigation-${++sequence}`;
                  live.set(id, { id, issue: value.issue, stage, startedAt: 1000 });
                  return id;
                }),
              investigated: (id) =>
                Effect.sync(() => {
                  live.delete(id);
                }),
            }),
            Layer.succeed(Issues, {
              pullRequest: () => Effect.succeed({ kind: 'absent' }),
              inspect: () =>
                Effect.succeed({
                  open: true,
                  author: 'rafaeltab',
                  labels: ['ready-for-agent'],
                  blockers: [],
                  blockersReady: true,
                  url: intent.issueUrl,
                }),
            }),
            Layer.succeed(Execution, {
              launch: () =>
                Effect.sync(() => {
                  launches++;
                  return { kind: 'uncertain' as const };
                }),
              sendStage: () => Effect.void,
              interrupt: () => Effect.void,
              observe: (active) =>
                Effect.gen(function* () {
                  if (hold || (firstObservation && launches > 0)) {
                    yield* Deferred.succeed(entered, undefined);
                    yield* Deferred.await(release);
                  }
                  return launches
                    ? { kind: 'absent' as const }
                    : {
                        kind: 'found' as const,
                        threadId: 'old-thread',
                        status: 'failed',
                        branch: active.branch,
                        worktree: '/worker',
                        model: 'gpt-6.1-sol',
                        run: { id: 'run-2', ordinal: 2 },
                      };
                }),
              inspectStage: (_active, request) =>
                Effect.succeed({
                  stageIndex: request.index,
                  runId: 'run-2',
                  ordinal: 2,
                  commit: intent.base,
                  accepted: false,
                  idle: true,
                  worktreeClean: true,
                }),
            })
          )
        )
      )
    );
    try {
      const job = await runtime.runPromise(Job);
      const stopped = await runtime.runPromise(job.status());
      if (stopped.kind !== 'job' || !stopped.retry)
        throw new Error('Missing supported fresh retry');
      const retry = runtime.runPromise(job.retry({ ...stopped.retry, jobId: intent.id }));
      if (!firstObservation) {
        expect(await retry).toMatchObject({ kind: 'job', execution: { kind: 'absent' } });
        hold = true;
      }
      const observation = firstObservation ? retry : runtime.runPromise(job.status());
      await Effect.runPromise(Deferred.await(entered));
      expect([...live.values()]).toEqual([
        { id: expect.any(String), issue: 723, stage: undefined, startedAt: 1000 },
      ]);
      await Effect.runPromise(Deferred.succeed(release, undefined));
      expect(await observation).toMatchObject({ kind: 'job', execution: { kind: 'absent' } });
      expect((await Effect.runPromise(store.readControl())).restart).toEqual({ index: 2 });
      expect([...live.values()]).toEqual([]);
      expect(launches).toBe(1);
      expect((await Effect.runPromise(store.readControl())).claimed).toEqual([1, 2]);
      expect(await Effect.runPromise(store.readStage(2))).toBeNull();
    } finally {
      await Effect.runPromise(Deferred.succeed(release, undefined));
      await runtime.dispose();
    }
  }
);
