import { Effect } from 'effect';
import { loadConfig } from './config.js';
import { initializeOtel } from './otel-init.js';
/** Parse before accepting work; initialize telemetry before importing external clients. */
export const userProgram = Effect.gen(function* () {
  const config = yield* Effect.try(() => loadConfig());
  const telemetry = yield* initializeOtel(config);
  const { startUser } = yield* Effect.tryPromise(() => import('./server.js'));
  const server = yield* startUser(config, {
    otelHealthy: telemetry._tag === 'Started',
  });
  yield* Effect.logInfo('User listening', { address: server.address });
  yield* Effect.never;
}).pipe(Effect.scoped);
