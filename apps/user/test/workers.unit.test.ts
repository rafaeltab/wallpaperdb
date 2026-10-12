import { Deferred, Effect, Layer, ManagedRuntime } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';
import { Workers, workerLayer } from '../src/workers.js';

describe('Scoped maintenance workers', () => {
  it('does not overlap a blocked batch while another worker recovers from failure', async () => {
    let blockedRuns = 0;
    let recoveredRuns = 0;
    const release = await Effect.runPromise(Deferred.make<void>());
    const runtime = ManagedRuntime.make(workerLayer([
      {name:'blocked',intervalMs:1,run:()=>Effect.sync(()=>{blockedRuns++;}).pipe(Effect.andThen(Deferred.await(release)),Effect.as(true))},
      {name:'recovering',intervalMs:1,run:()=>Effect.suspend(()=>++recoveredRuns === 1 ? Effect.fail('expected failure') : Effect.succeed(true))},
    ],10));
    try {
      await runtime.runPromise(Workers);
      await expect.poll(()=>recoveredRuns).toBeGreaterThanOrEqual(3);
      expect(blockedRuns).toBe(1);
      expect(await runtime.runPromise(Workers.use(workers=>workers.check()))).toBe(true);
    } finally {
      const closing=runtime.dispose();
      await Effect.runPromise(Deferred.succeed(release,undefined));
      await closing;
    }
  });
  it('stops every worker before one shared shutdown deadline', async () => {
    const begun = new Set<string>();
    const stopped = new Set<string>();
    const runtime = ManagedRuntime.make(workerLayer(['one', 'two'].map(name => ({
      name, intervalMs: 1, run: () => Effect.sync(() => begun.add(name)).pipe(
        Effect.andThen(Effect.never), Effect.onInterrupt(() => Effect.sync(() => { stopped.add(name); }))
      ),
    })), 5000).pipe(Layer.provideMerge(TestClock.layer())));
    await runtime.runPromise(Workers);
    await expect.poll(() => begun.size).toBe(2);
    const adjust = await runtime.runPromise(Effect.context<TestClock.TestClock>());
    const closing = runtime.dispose();
    await Effect.runPromise(TestClock.adjust('5 seconds').pipe(Effect.provide(adjust)));
    await expect.poll(() => stopped.size).toBe(2);
    await closing;
  });
  it('interrupts a blocked operation at the deadline and releases remaining resources', async () => {
    const started = await Effect.runPromise(Deferred.make<void>());
    let interrupted = false;
    const runtime = ManagedRuntime.make(workerLayer([{
      name:'blocked',intervalMs:1,
      run: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never), Effect.onInterrupt(() => Effect.sync(() => {interrupted=true;}))),
    }], 10));
    await runtime.runPromise(Workers);
    await Effect.runPromise(Deferred.await(started));
    await runtime.dispose();
    expect(interrupted).toBe(true);
  });
  it('waits for the active batch and prevents a new batch during shutdown', async () => {
    const started = await Effect.runPromise(Deferred.make<void>());
    const finish = await Effect.runPromise(Deferred.make<void>());
    const events: string[] = [];
    const runtime = ManagedRuntime.make(workerLayer([{
      name: 'test-work', intervalMs: 1,
      run: (stopping) => Effect.gen(function* () {
        events.push('started');
        yield* Deferred.succeed(started, undefined);
        yield* Deferred.await(finish);
        expect(stopping()).toBe(true);
        events.push('finished');
        return true;
      }),
    }], 500));
    await runtime.runPromise(Workers);
    await Effect.runPromise(Deferred.await(started));
    const stopping = runtime.dispose();
    await Effect.runPromise(Deferred.succeed(finish, undefined));
    await stopping;
    expect(events).toEqual(['started', 'finished']);
  });
});
