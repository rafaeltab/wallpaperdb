import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import type { Attempts } from '../capabilities/plan/index.js';
import type { Unavailable } from '../capabilities/job/index.js';
/** Composition owns background execution independently of HTTP connections. */
export async function planningWorker(config: {
  attempts: Attempts;
  run: <A>(effect: Effect.Effect<A, Unavailable>) => Promise<A>;
}) {
  let work: Promise<void> | undefined;
  const queue: string[] = [];
  const pump = () => {
    if (work) return;
    const id = queue.shift();
    if (!id) return;
    work = config.run(config.attempts.execute(id)).finally(() => {
      work = undefined;
      pump();
    });
    void work.catch(() => undefined);
  };
  const start = (id: string) => {
    queue.push(id);
    pump();
  };
  const pending = await config.run(config.attempts.pending());
  if (pending) start(pending.id);
  return {
    submit: async () => {
      const result = await config.run(config.attempts.submit(randomUUID()));
      if (result.kind === 'accepted' && result.id) start(result.id);
      return result;
    },
    observe: (id: string) => config.run(config.attempts.observe(id)),
    close: async () => {
      while (work) await work.catch(() => undefined);
    },
  };
}
