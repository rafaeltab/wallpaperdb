import 'dotenv/config';
import { Effect, Schema } from 'effect';
import { loadConfig } from './config.js';
import { initializeOtel } from './otel-init.js';

class ConfigurationFailure extends Schema.TaggedError<ConfigurationFailure>()(
  'ConfigurationFailure',
  { message: Schema.String }
) {}

/** Validate configuration and install instrumentation before loading external clients. */
export const tagsProgram = Effect.gen(function* () {
  const config = yield* Effect.try({
    try: () => loadConfig(),
    catch: () => new ConfigurationFailure({ message: 'Invalid tags configuration' }),
  });
  const telemetry = yield* initializeOtel(config);
  const { startTags } = yield* Effect.tryPromise(() => import('./server.js'));
  const server = yield* startTags(config, { otelHealthy: telemetry._tag === 'Started' });
  yield* Effect.logInfo('Tags listening', { address: server.address });
  yield* Effect.never;
}).pipe(Effect.scoped);
