import { controlledStore } from './fixtures/store.js';
import { Clock, Effect, Layer, ManagedRuntime } from 'effect';
import { TestClock } from 'effect/testing';
import { expect, it } from 'vitest';
import {
  Execution,
  Issues,
  Time,
  Job,
  JobLive,
  JobStore,
  type Issues as IssuePort,
} from '../src/capabilities/job/index.js';
const facts = {
  open: true,
  author: 'rafaeltab',
  labels: ['ready-for-agent'],
  blockersReady: true,
  url: 'https://github.com/rafaeltab/wallpaperdb/issues/576',
};
function setup(issue: Effect.Success<ReturnType<IssuePort['inspect']>> = facts) {
  const store = controlledStore();
  let launches = 0;
  const runtime = ManagedRuntime.make(
    JobLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(Time, { now: () => Clock.currentTimeMillis }),
          Layer.succeed(JobStore, store),
          Layer.succeed(Issues, { inspect: () => Effect.succeed(issue) }),
          Layer.succeed(Execution, {
            launch: () =>
              Effect.sync(() => {
                launches++;
                return { kind: 'submitted' as const };
              }),
            observe: () => Effect.succeed({ kind: 'absent' as const }),
          })
        )
      ),
      Layer.provideMerge(TestClock.layer())
    )
  );
  return {
    runtime,
    launches: () => launches,
    start: () =>
      runtime.runPromise(
        Effect.flatMap(Job, (job) => job.start({ issue: 576, base: 'a'.repeat(40), context: '' }))
      ),
    saved: () => Effect.runPromise(store.read()),
  };
}
it.each([
  { ...facts, open: false },
  { ...facts, author: 'outside' },
  { ...facts, labels: [] },
  { ...facts, labels: ['ready-for-agent', 'future-work'] },
  { ...facts, labels: ['ready-for-agent', 'spec'] },
  { ...facts, blockersReady: false },
])('rejects unauthorized or blocked observations before admission %#', async (facts) => {
  const app = setup(facts);
  try {
    expect(await app.start()).toEqual({ kind: 'rejected' });
    expect(await app.saved()).toBeNull();
    expect(app.launches()).toBe(0);
  } finally {
    await app.runtime.dispose();
  }
});
it('accepts the second trusted maintainer and reports controlled elapsed time', async () => {
  const app = setup({ ...facts, author: 'zero-two-rafaeltab' });
  try {
    expect(await app.start()).toMatchObject({ kind: 'job', elapsedMs: 0 });
    await app.runtime.runPromise(TestClock.adjust(12000));
    expect(await app.runtime.runPromise(Effect.flatMap(Job, (job) => job.status()))).toMatchObject({
      kind: 'job',
      elapsedMs: 12000,
    });
  } finally {
    await app.runtime.dispose();
  }
});
it('reserves competing requests once before external launch', async () => {
  const app = setup();
  try {
    const results = await Promise.all([app.start(), app.start()]);
    expect(results.map((result) => result.kind).sort()).toEqual(['job', 'occupied']);
    expect(app.launches()).toBe(1);
  } finally {
    await app.runtime.dispose();
  }
});
