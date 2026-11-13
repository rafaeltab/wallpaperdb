import { Effect, Deferred, Option } from 'effect';
import { expect } from 'vitest';
import { Unavailable } from '../../src/capabilities/job/index.js';
import type { ScheduleStore } from '../../src/capabilities/plan/index.js';
export async function scheduleContract(store: ScheduleStore, reopen: () => ScheduleStore) {
  expect(await Effect.runPromise(store.read())).toEqual({
    revision: -1,
    concurrency: 1,
    allowance: 1,
    paused: false,
    admissions: [],
  });
  const first = {
    revision: 0,
    concurrency: -1,
    allowance: 3,
    paused: true,
    resuming: [{ issue: 1, index: 0, questionId: 'q', run: { id: 'run-1', ordinal: 1 } }],
    admissions: [{ issue: 1, base: 'a'.repeat(40), context: 'Approved scope' }],
    cycle: {
      requestId: 'retained-cycle',
      startedAt: 1,
      concurrency: -1,
      allowance: 3,
      selected: [{ issue: 2, reason: 'Verified code', includeCodeFromIssues: [1] }],
      scope: 'authorized requirements',
      bases: [{ issue: 2, base: 'a'.repeat(40) }],
    },
    recovering: [4],
  };
  const competing = await Promise.all([
    Effect.runPromise(store.save(first)),
    Effect.runPromise(reopen().save({ ...first, concurrency: 2 })),
  ]);
  expect(competing.filter(Boolean)).toHaveLength(1);
  const read = await Effect.runPromise(reopen().read());
  expect(read).toMatchObject({
    revision: 0,
    allowance: 3,
    paused: true,
    resuming: [{ issue: 1, index: 0, questionId: 'q', run: { id: 'run-1', ordinal: 1 } }],
    admissions: first.admissions,
  });
  expect(await Effect.runPromise(store.save({ ...read, revision: 0 }))).toBe(false);
  expect(await Effect.runPromise(store.save({ ...read, revision: 1, paused: false }))).toBe(true);
  expect(await Effect.runPromise(reopen().read())).toEqual({ ...read, revision: 1, paused: false });
  const entered = await Effect.runPromise(Deferred.make<void>());
  const release = await Effect.runPromise(Deferred.make<void>());
  const owning = Effect.runPromise(
    store.withCycle(
      Effect.gen(function* () {
        yield* Deferred.succeed(entered, undefined);
        yield* Deferred.await(release);
        return 'completed';
      })
    )
  );
  await Effect.runPromise(Deferred.await(entered));
  try {
    expect(
      Option.isNone(await Effect.runPromise(reopen().withCycle(Effect.succeed('competing'))))
    ).toBe(true);
  } finally {
    await Effect.runPromise(Deferred.succeed(release, undefined));
  }
  expect(Option.getOrUndefined(await owning)).toBe('completed');
  expect(
    Option.getOrUndefined(await Effect.runPromise(reopen().withCycle(Effect.succeed('next'))))
  ).toBe('next');
  await expect(
    Effect.runPromise(
      store.withCycle(
        Effect.fail(new Unavailable({ operation: 'controlled-cycle-failure', cause: null }))
      )
    )
  ).rejects.toMatchObject({ operation: 'controlled-cycle-failure' });
  expect(
    Option.getOrUndefined(
      await Effect.runPromise(reopen().withCycle(Effect.succeed('after-failure')))
    )
  ).toBe('after-failure');
  const retry = {
    ...read,
    revision: 2,
    resuming: [
      { issue: 1, index: 1, runId: 'failed-review', run: { id: 'failed-review', ordinal: 2 } },
    ],
  };
  expect(await Effect.runPromise(store.save(retry))).toBe(true);
  expect(await Effect.runPromise(reopen().read())).toEqual(retry);
}
