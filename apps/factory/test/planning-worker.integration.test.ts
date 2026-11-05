import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { planningWorker } from '../src/composition/index.js';
it('executes an accepted successor while predecessor terminal cleanup is still settling and drains both', async () => {
  const executed: string[] = [];
  let release = () => {};
  const closing = new Promise<void>((resolve) => {
    release = resolve;
  });
  const worker = await planningWorker({
    attempts: {
      pending: () => Effect.succeed(undefined),
      submit: (id) => Effect.succeed({ kind: 'accepted', id }),
      observe: () => Effect.succeed(undefined),
      execute: (id) =>
        Effect.promise(async () => {
          executed.push(id);
          if (executed.length === 1) await closing;
        }),
    },
    run: Effect.runPromise,
  });
  const first = await worker.submit();
  const second = await worker.submit();
  release();
  await worker.close();
  if (first.kind !== 'accepted' || second.kind !== 'accepted')
    throw new Error('Expected acceptance');
  expect(executed).toEqual([first.id, second.id]);
});
