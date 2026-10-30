import { Effect, Layer } from 'effect';
import { expect, it } from 'vitest';
import { Execution, Issues, Job, JobLive, JobStore, Time } from '../src/capabilities/job/index.js';
import { controlledStore } from './fixtures/store.js';
it('requires fresh accepted stages and matching current CI before reporting readiness', async () => {
  const store = controlledStore();
  let stage = 0;
  let accepted = false;
  let ci = false;
  const sent: number[] = [];
  const deps = Layer.mergeAll(
    Layer.succeed(JobStore, store),
    Layer.succeed(Time, { now: () => Effect.succeed(100) }),
    Layer.succeed(Issues, {
      pullRequest: () =>
        Effect.succeed({
          kind: 'found' as const,
          url: 'https://github.com/rafaeltab/wallpaperdb/pull/999',
          commit: 'b'.repeat(40),
          ready: ci,
          landed: false,
        }),
      inspect: () =>
        Effect.succeed({
          open: true,
          author: 'rafaeltab',
          labels: ['ready-for-agent'],
          blockersReady: true,
          url: 'https://github.com/rafaeltab/wallpaperdb/issues/577',
        }),
    }),
    Layer.succeed(Execution, {
      launch: () => Effect.succeed({ kind: 'submitted' as const }),
      observe: (intent) =>
        Effect.succeed({
          kind: 'found' as const,
          threadId: 't',
          status: 'completed',
          worktree: '/worker',
          branch: intent.branch,
          model: 'gpt-6.1-sol',
        }),
      inspectStage: (_intent, request) =>
        Effect.succeed({
          runId: `run-${stage}`,
          ordinal: stage + 1,
          commit: 'b'.repeat(40),
          accepted: accepted && request.index === stage,
          linked: ['https://github.com/rafaeltab/wallpaperdb/pull/999'],
        }),
      sendStage: (_intent, request) =>
        Effect.sync(() => {
          sent.push(request.index);
          stage = request.index;
          accepted = false;
        }),
    })
  );
  const run = <A>(
    effect: Effect.Effect<A, import('../src/capabilities/job/index.js').Unavailable, Job>
  ) => Effect.runPromise(effect.pipe(Effect.provide(JobLive.pipe(Layer.provide(deps)))));
  await run(
    Effect.flatMap(Job, (job) => job.start({ issue: 577, base: 'a'.repeat(40), context: '' }))
  );
  await run(Effect.flatMap(Job, (job) => job.status()));
  expect(sent).toEqual([]);
  accepted = true;
  await run(Effect.flatMap(Job, (job) => job.status()));
  expect(sent).toEqual([1]);
  await run(Effect.flatMap(Job, (job) => job.status()));
  expect(sent).toEqual([1]);
  accepted = true;
  await run(Effect.flatMap(Job, (job) => job.status()));
  expect(sent).toEqual([1, 2]);
  accepted = true;
  expect(await run(Effect.flatMap(Job, (job) => job.status()))).toMatchObject({
    delivery: { stage: 'ci', ready: false, landed: false },
  });
  ci = true;
  expect(await run(Effect.flatMap(Job, (job) => job.status()))).toMatchObject({
    delivery: { stage: 'ci', ready: true, landed: false },
  });
  expect(sent).toEqual([1, 2]);
});
