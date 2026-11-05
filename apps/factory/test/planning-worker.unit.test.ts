import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { planningWorker } from '../src/composition/index.js';
import { Unavailable } from '../src/capabilities/job/index.js';
const retained = {
  id: 'retained',
  revision: 0,
  startedAt: 100,
  deadline: 120100,
  phase: 'discovery' as const,
};
it.each(['typed', 'defect'] as const)(
  'retains pending responsibility after a %s execution failure and resumes that identity on reopen',
  async (kind) => {
    let pending = true;
    let fail = true;
    const executed: string[] = [];
    const attempts = {
      pending: () => Effect.succeed(pending ? retained : undefined),
      submit: () => Effect.die('Restoring work must not create an admission'),
      observe: () => Effect.succeed(undefined),
      execute: (id: string) =>
        Effect.suspend(() => {
          executed.push(id);
          if (fail)
            return kind === 'typed'
              ? Effect.fail(
                  new Unavailable({ operation: 'synthetic-persistence-failure', cause: null })
                )
              : Effect.die(new Error('synthetic defect'));
          pending = false;
          return Effect.void;
        }),
    };
    const first = await planningWorker({ attempts, run: Effect.runPromise });
    await first.close();
    expect(pending).toBe(true);
    fail = false;
    const reopened = await planningWorker({ attempts, run: Effect.runPromise });
    await reopened.close();
    expect(executed).toEqual(['retained', 'retained']);
    expect(pending).toBe(false);
  }
);
it('returns existing ownership and observation without queuing an unaccepted request', async () => {
  const executed: string[] = [];
  const snapshot = {
    ...retained,
    phase: 'failed',
    finishedAt: 200,
    elapsedMs: 100,
    detail: 'Synthetic dependency unavailable',
  };
  const worker = await planningWorker({
    attempts: {
      pending: () => Effect.succeed(undefined),
      submit: () =>
        Effect.succeed({ kind: 'blocked', requestId: 'legacy', reason: 'reconciliation-required' }),
      observe: (id) => Effect.succeed(id === retained.id ? snapshot : undefined),
      execute: (id) =>
        Effect.sync(() => {
          executed.push(id);
        }),
    },
    run: Effect.runPromise,
  });
  try {
    expect(await worker.submit()).toEqual({
      kind: 'blocked',
      requestId: 'legacy',
      reason: 'reconciliation-required',
    });
    expect(await worker.observe(retained.id)).toEqual(snapshot);
    expect(await worker.observe('missing')).toBeUndefined();
  } finally {
    await worker.close();
  }
  expect(executed).toEqual([]);
});
