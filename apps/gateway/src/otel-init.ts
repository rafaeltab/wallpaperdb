import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { Effect, Schema, type Scope } from 'effect';

export type OtelStatus =
  | { readonly _tag: 'Disabled' }
  | { readonly _tag: 'Started' }
  | { readonly _tag: 'Unavailable' };
class OtelInitializationError extends Schema.TaggedError<OtelInitializationError>()(
  'OtelInitializationError',
  { cause: Schema.Defect() }
) {}
const shutdownSdk = Effect.fn('gateway.telemetry.shutdown')(function* (sdk: NodeSDK) {
  yield* Effect.tryPromise(() => sdk.shutdown()).pipe(
    Effect.interruptible,
    Effect.timeout('5 seconds'),
    Effect.catch(() => Effect.logWarning('Gateway telemetry shutdown failed'))
  );
});

/** Must run before loading adapters so auto-instrumentation observes their first imports. */
export const initializeOtel = Effect.fn('gateway.telemetry.initialize')(function* (config: {
  readonly otelEndpoint?: string;
  readonly otelServiceName: string;
}): Effect.fn.Return<OtelStatus, never, Scope.Scope> {
  if (!config.otelEndpoint) return { _tag: 'Disabled' };
  const endpoint = config.otelEndpoint.replace(/\/+$/, '');
  const acquire = Effect.gen(function* () {
    const sdk = yield* Effect.try({
      try: () =>
        new NodeSDK({
          serviceName: config.otelServiceName,
          traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
          metricReaders: [
            new PeriodicExportingMetricReader({
              exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
              exportIntervalMillis: 60000,
            }),
          ],
          instrumentations: [
            getNodeAutoInstrumentations({
              '@opentelemetry/instrumentation-fs': { enabled: false },
            }),
          ],
        }),
      catch: (cause) => new OtelInitializationError({ cause }),
    });
    yield* Effect.try({
      try: () => sdk.start(),
      catch: (cause) => new OtelInitializationError({ cause }),
    }).pipe(Effect.onError(() => shutdownSdk(sdk)));
    return sdk;
  });
  return yield* Effect.acquireRelease(acquire, shutdownSdk).pipe(
    Effect.as<OtelStatus>({ _tag: 'Started' }),
    Effect.catchTag('OtelInitializationError', () =>
      Effect.logWarning('Gateway telemetry initialization failed').pipe(
        Effect.as<OtelStatus>({ _tag: 'Unavailable' })
      )
    )
  );
});
