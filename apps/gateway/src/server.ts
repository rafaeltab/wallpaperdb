import { Effect, Schema, type Scope } from 'effect';
import { createApp } from './app.js';
import type { Config } from './config.js';

export class GatewayStartupError extends Schema.TaggedError<GatewayStartupError>()(
  'GatewayStartupError',
  { stage: Schema.Literals(['application', 'listener']), cause: Schema.Defect() }
) {}
export class GatewayShutdownError extends Schema.TaggedError<GatewayShutdownError>()(
  'GatewayShutdownError',
  { cause: Schema.Defect() }
) {}
export interface RunningGateway {
  readonly address: string;
}

/** The caller owns the listening lifetime through Scope; executable process policy stays outside. */
export const startGateway = Effect.fn('gateway.start')(function* (
  config: Config,
  options: { readonly otelHealthy?: boolean } = {}
): Effect.fn.Return<RunningGateway, GatewayStartupError, Scope.Scope> {
  const app = yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: () => createApp(config, { logger: true, otelHealthy: options.otelHealthy }),
      catch: (cause) => new GatewayStartupError({ stage: 'application', cause }),
    }),
    (app) =>
      Effect.tryPromise(() => app.close()).pipe(
        Effect.interruptible,
        Effect.timeout('15 seconds'),
        Effect.mapError((cause) => new GatewayShutdownError({ cause })),
        Effect.orDie
      )
  );
  const address = yield* Effect.tryPromise({
    try: () => app.listen({ port: config.port, host: '0.0.0.0' }),
    catch: (cause) => new GatewayStartupError({ stage: 'listener', cause }),
  });
  return { address };
});
