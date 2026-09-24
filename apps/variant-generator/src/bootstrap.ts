import { Effect } from 'effect';
import { loadConfig } from './config.js';
import { initializeOtel } from './otel-init.js';
/** Parse before accepting work; initialize telemetry before importing external clients. */
export const variantGeneratorProgram = Effect.gen(function* () {
  const config = yield* Effect.try(() => loadConfig());
  const telemetry = yield* initializeOtel(config);
  const { startVariantGenerator } = yield* Effect.tryPromise(() => import('./server.js'));
  const server = yield* startVariantGenerator(config, {
    otelHealthy: telemetry._tag === 'Started',
  });
  yield* Effect.logInfo('Variant generator listening', { address: server.address });
  yield* Effect.never;
}).pipe(Effect.scoped);
