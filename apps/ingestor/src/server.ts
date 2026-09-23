import { Effect, Schema, type Scope } from 'effect';
import type { FastifyInstance } from 'fastify';
import { createApp } from './app.js';
import type { Config } from './config.js';
export class IngestorStartupError extends Schema.TaggedError<IngestorStartupError>()(
  'IngestorStartupError',
  { stage: Schema.Literals(['application', 'listener']), cause: Schema.Defect() }
) {}
const close = (app: FastifyInstance) => Effect.tryPromise(() => app.close()).pipe(Effect.orDie);
export const startIngestor = Effect.fn('ingestor.start')(function* (
  config: Config,
  options: { readonly otelHealthy?: boolean } = {}
): Effect.fn.Return<{ readonly address: string }, IngestorStartupError, Scope.Scope> {
  const app = yield* Effect.acquireRelease(
    Effect.callback<FastifyInstance, IngestorStartupError>((resume, signal) => {
      const starting = createApp(config, { logger: true, signal, ...options });
      starting.then(
        (app) => resume(Effect.succeed(app)),
        (cause) => resume(Effect.fail(new IngestorStartupError({ stage: 'application', cause })))
      );
      return Effect.tryPromise(() => starting).pipe(
        Effect.matchEffect({ onFailure: () => Effect.void, onSuccess: close })
      );
    }),
    close,
    { interruptible: true }
  );
  const address = yield* Effect.tryPromise({
    try: () => app.listen({ port: config.port, host: '0.0.0.0' }),
    catch: (cause) => new IngestorStartupError({ stage: 'listener', cause }),
  });
  return { address };
});
