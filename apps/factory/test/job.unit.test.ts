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
            Effect.flatMap(store.read(), (intent) =>
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
