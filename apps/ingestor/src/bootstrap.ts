import { Effect, Schema } from 'effect';
import { ingestorConfig } from './config.js';
import { initializeOtel } from './otel-init.js';
class BootstrapFailure extends Schema.TaggedError<BootstrapFailure>()('BootstrapFailure', {
  cause: Schema.Defect(),
}) {}
/** Telemetry starts before importing instrumented adapters; process execution belongs to index.ts. */
export const ingestorProgram = Effect.gen(function* () {
  const config = yield* ingestorConfig;
  const telemetry = yield* initializeOtel(config);
  const { startIngestor } = yield* Effect.tryPromise({
    try: () => import('./server.js'),
    catch: (cause) => new BootstrapFailure({ cause }),
  });
  const server = yield* startIngestor(config, { otelHealthy: telemetry._tag === 'Started' });
  yield* Effect.logInfo('Ingestor listening', { address: server.address });
  yield* Effect.never;
}).pipe(Effect.scoped);
