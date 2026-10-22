import 'dotenv/config';
import { Effect, Schema } from 'effect';
import { loadConfig } from './config.js';
import { initializeOtel } from './otel-init.js';

class ConfigurationFailure extends Schema.TaggedError<ConfigurationFailure>()(
  'ConfigurationFailure',
  { message: Schema.String }
) {}

/** Validate configuration and install instrumentation before loading external clients. */
export const wallpaperProgram = Effect.gen(function* () {
  const config = yield* Effect.try({
    try: () => loadConfig(),
    catch: () => new ConfigurationFailure({ message: 'Invalid wallpaper configuration' }),
  });
  if (!config.workflow)
    yield* Effect.fail(
      new ConfigurationFailure({ message: 'Wallpaper workflow configuration is required' })
    );
  const telemetry = yield* initializeOtel(config);
  const { startWallpaper } = yield* Effect.tryPromise(() => import('./server.js'));
  const server = yield* startWallpaper(config, { otelHealthy: telemetry._tag === 'Started' });
  yield* Effect.logInfo('Wallpaper listening', { address: server.address });
  yield* Effect.never;
}).pipe(Effect.scoped);
