import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  Job,
  JobLive,
  JobStore,
  Issues,
  Execution,
  type Intent,
} from '../src/capabilities/job/index.js';

describe('one deliberate implementation job', () => {
  it('persists intent before launch, keeps an uncertain launch reserved, and reconciles it', async () => {
    let intent: Intent | null = null;
    let launches = 0;
    let found = false;
    const store = {
      read: () => Effect.succeed(intent),
      reserve: (value: Intent) =>
        Effect.sync(() => {
          if (intent) return false;
          intent = value;
          return true;
        }),
      claimLaunch: () =>
        Effect.sync(() => {
          if (launches) return false;
          launches++;
          return true;
        }),
    };
    const deps = Layer.mergeAll(
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
          Effect.sync(() => {
            expect(intent?.expectedStage).toBe('implementation');
            return { kind: 'uncertain' as const };
          }),
        observe: () =>
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
          ),
      })
    );
    const run = <A, E>(effect: Effect.Effect<A, E, Job>) =>
      Effect.runPromise(effect.pipe(Effect.provide(JobLive.pipe(Layer.provide(deps)))));
    expect(
      (
        await run(
          Effect.flatMap(Job, (job) =>
            job.start({ issue: 576, base: '4d545298010b8f13883aa6f7cff5d16da808fb91', context: '' })
          )
        )
      ).kind
    ).toBe('job');
    expect(
      (
        await run(
          Effect.flatMap(Job, (job) =>
            job.start({ issue: 577, base: '4d545298010b8f13883aa6f7cff5d16da808fb91', context: '' })
          )
        )
      ).kind
    ).toBe('occupied');
    await run(Effect.flatMap(Job, (job) => job.status()));
    expect(launches).toBe(1);
    found = true;
    const status = await run(Effect.flatMap(Job, (job) => job.status()));
    expect(status).toMatchObject({
      kind: 'job',
      execution: { kind: 'found', threadId: 'thread-1' },
    });
  });
});
