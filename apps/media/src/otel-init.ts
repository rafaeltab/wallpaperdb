import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { OtelMetrics, Resource } from '@effect/opentelemetry';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { logs as sdkLogs, NodeSDK } from '@opentelemetry/sdk-node';
import { Effect, Schema, type Scope } from 'effect';

export type OtelStatus =
  | { readonly _tag: 'Disabled' }
  | { readonly _tag: 'Started' }
  | { readonly _tag: 'Unavailable' };

class OtelInitializationError extends Schema.TaggedError<OtelInitializationError>()(
  'OtelInitializationError',
  { cause: Schema.Defect() }
) {}

const exportTimeoutMillis = 1000;

const shutdownSdk = (sdk: NodeSDK) =>
  Effect.tryPromise(() => sdk.shutdown()).pipe(
    Effect.interruptible,
    Effect.timeout('4 seconds'),
    Effect.catch(() => Effect.logWarning('Media telemetry shutdown failed'))
  );

/** Initialize before loading adapters so auto-instrumentation sees their first imports. */
export const initializeOtel = Effect.fn('media.telemetry.initialize')(function* (config: {
  readonly otelEndpoint?: string;
  readonly otelServiceName: string;
}): Effect.fn.Return<OtelStatus, never, Scope.Scope> {
  if (!config.otelEndpoint) return { _tag: 'Disabled' };
  const endpoint = config.otelEndpoint.replace(/\/+$/, '');
  const initialize = Effect.gen(function* () {
    const url = yield* Effect.try({
      try: () => new URL(endpoint),
      catch: (cause) => new OtelInitializationError({ cause }),
    });
    const agent = yield* Effect.acquireRelease(
      Effect.sync(() =>
        url.protocol === 'https:'
          ? new HttpsAgent({ keepAlive: false })
          : new HttpAgent({ keepAlive: false })
      ),
      (agent) => Effect.sync(() => agent.destroy())
    );
    const effectMetrics = yield* OtelMetrics.makeProducer().pipe(
      Effect.provide(Resource.layer({ serviceName: config.otelServiceName }))
    );
    const transport = { timeoutMillis: exportTimeoutMillis, httpAgentOptions: async () => agent };
    const acquireSdk = Effect.gen(function* () {
      const sdk = yield* Effect.try({
        try: () =>
          new NodeSDK({
            serviceName: config.otelServiceName,
            traceExporter: new OTLPTraceExporter({ ...transport, url: `${endpoint}/v1/traces` }),
            logRecordProcessors: [
              new sdkLogs.BatchLogRecordProcessor({
                exporter: new OTLPLogExporter({ ...transport, url: `${endpoint}/v1/logs` }),
                exportTimeoutMillis,
              }),
            ],
            metricReaders: [
              new PeriodicExportingMetricReader({
                metricProducers: [effectMetrics],
                exporter: new OTLPMetricExporter({ ...transport, url: `${endpoint}/v1/metrics` }),
                exportIntervalMillis: 60000,
                exportTimeoutMillis,
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
    yield* Effect.acquireRelease(
      acquireSdk.pipe(Effect.onError(() => Effect.sync(() => agent.destroy()))),
      shutdownSdk
    );
    return { _tag: 'Started' } as const;
  });
  return yield* initialize.pipe(
    Effect.catchTag('OtelInitializationError', (error) =>
      Effect.logWarning('Media telemetry initialization failed', {
        cause: error.cause,
      }).pipe(Effect.as<OtelStatus>({ _tag: 'Unavailable' }))
    )
  );
});
