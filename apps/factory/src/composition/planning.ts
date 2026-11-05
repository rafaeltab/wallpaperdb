import { randomUUID } from 'node:crypto';
import { Effect, Cause, type Tracer } from 'effect';
import type { Attempts } from '../capabilities/plan/index.js';
import { Unavailable } from '../capabilities/job/index.js';
/** Composition owns background execution independently of HTTP connections. */
export async function planningWorker(config: {
  attempts: Attempts;
  run: <A>(effect: Effect.Effect<A, Unavailable>) => Promise<A>;
}) {
  let work: Promise<void> | undefined;
  const queue: { id: string; parent?: Tracer.Span }[] = [];
  const pump = () => {
    if (work) return;
    const entry = queue.shift();
    if (!entry) return;
    const operation = config.attempts.execute(entry.id).pipe(
      Effect.catchCause((cause) =>
        Effect.logError('Planning background execution failed; durable ownership retained', {
          attemptId: entry.id,
          causes: cause.reasons.map((reason) => ({
            kind: reason._tag,
            operation:
              Cause.isFailReason(reason) && reason.error instanceof Unavailable
                ? reason.error.operation
                : 'unexpected-background-failure',
          })),
        })
      )
    );
    work = config
      .run(entry.parent ? operation.pipe(Effect.withParentSpan(entry.parent)) : operation)
      .finally(() => {
        work = undefined;
        pump();
      });
    void work.catch(() => undefined);
  };
  const start = (id: string, parent?: Tracer.Span) => {
    queue.push({ id, parent });
    pump();
  };
  const pending = await config.run(config.attempts.pending());
  if (pending) start(pending.id);
  return {
    submit: async (parent?: Tracer.Span) => {
      const operation = config.attempts.submit(randomUUID());
      const result = await config.run(
        parent ? operation.pipe(Effect.withParentSpan(parent)) : operation
      );
      if (result.kind === 'accepted') start(result.id, parent);
      return result;
    },
    observe: (id: string, parent?: Tracer.Span) => {
      const operation = config.attempts.observe(id);
      return config.run(parent ? operation.pipe(Effect.withParentSpan(parent)) : operation);
    },
    close: async () => {
      while (work) await work.catch(() => undefined);
    },
  };
}
