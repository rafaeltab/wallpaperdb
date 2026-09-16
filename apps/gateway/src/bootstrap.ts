import { Cause, Effect, Schema } from 'effect';
import { gatewayConfig } from './config.js';
import { initializeOtel } from './otel-init.js';

export class GatewayBootstrapError extends Schema.TaggedError<GatewayBootstrapError>()(
  'GatewayBootstrapError',
  { cause: Schema.Defect() }
) {}

/** The ConfigProvider supplied by the owner resolves configuration before any resource is acquired. */
export const gatewayProgram = Effect.gen(function* () {
  const config = yield* gatewayConfig;
  const telemetry = yield* initializeOtel(config);
  const { startGateway } = yield* Effect.tryPromise({
    try: () => import('./server.js'),
    catch: (cause) => new GatewayBootstrapError({ cause }),
  });
  yield* startGateway(config, { otelHealthy: telemetry._tag !== 'Unavailable' });
  yield* Effect.never;
}).pipe(
  Effect.scoped,
  Effect.tapCause((cause) =>
    Cause.hasInterruptsOnly(cause)
      ? Effect.void
      : Effect.logError('Gateway failed to start or stop').pipe(
          Effect.annotateLogs({
            failures: cause.reasons.map((reason) => {
              if (reason._tag !== 'Fail') return { kind: reason._tag };
              const error = reason.error;
              if (error._tag === 'GatewayConfigurationError')
                return { kind: error._tag, fields: error.fields };
              if (error._tag === 'GatewayStartupError')
                return { kind: error._tag, stage: error.stage };
              return { kind: error._tag };
            }),
          })
        )
  )
);
