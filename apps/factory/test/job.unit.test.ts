import { Clock, Effect, Layer } from 'effect';
import { expect, it } from 'vitest';
import { Time, Job, JobLive, JobStore, Issues, Execution } from '../src/capabilities/job/index.js';
import { controlledStore } from './fixtures/store.js';
it('persists stage intent before launch, keeps uncertainty reserved, and reconciles without relaunch', async () => {
  const store = controlledStore();
  let launches = 0;
  let found = false;
  const dependencies = Layer.mergeAll(
    Layer.succeed(Time, { now: () => Clock.currentTimeMillis }),
    Layer.succeed(JobStore, store),
    Layer.succeed(Issues, {
      inspect: () =>
        Effect.succeed({
          open: true,
          author: 'rafaeltab',
          labels: ['ready-for-agent'],
          blockersReady: true,
          url: 'https://github.com/rafaeltab/wallpaperdb/issues/576',
        }),
    }),
    Layer.succeed(Execution, {
      launch: () =>
        Effect.flatMap(store.read(), (intent) =>
          Effect.sync(() => {
            expect(intent?.expectedStage).toBe('implementation');
            launches++;
            return { kind: 'uncertain' as const };
          })
        ),
      observe: () =>
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
  found = true;
  expect(await run(Effect.flatMap(Job, (job) => job.status()))).toMatchObject({
    kind: 'job',
    execution: { kind: 'found', threadId: 'thread-1' },
  });
  expect(launches).toBe(1);
});
