import {
  TelemetryExportTransport,
  telemetryBatchOptions,
  telemetryExportTimeoutMillis,
} from '@wallpaperdb/core/telemetry';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
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

const exportTimeoutMillis = telemetryExportTimeoutMillis;

const shutdownSdk = (sdk: NodeSDK, transports: TelemetryExportTransport) =>
  Effect.tryPromise(() => sdk.shutdown()).pipe(
    Effect.interruptible,
    Effect.timeout('4 seconds'),
    Effect.catch(() => Effect.logWarning('Variant generator telemetry shutdown failed')),
    Effect.ensuring(Effect.promise(() => transports.close()))
  );

/** Initialize before loading adapters so auto-instrumentation sees their first imports. */
export const initializeOtel = Effect.fn('variant-generator.telemetry.initialize')(
  function* (config: {
    readonly otelEndpoint?: string;
    readonly otelServiceName: string;
  }): Effect.fn.Return<OtelStatus, never, Scope.Scope> {
    if (!config.otelEndpoint) return { _tag: 'Disabled' };
    const endpoint = config.otelEndpoint.replace(/\/+$/, '');
    const transports = yield* Effect.acquireRelease(
      Effect.sync(() => new TelemetryExportTransport()),
      (transports) => Effect.promise(() => transports.close())
    );
    const initialize = Effect.gen(function* () {
      yield* Effect.try({
        try: () => new URL(endpoint),
        catch: (cause) => new OtelInitializationError({ cause }),
      });
      const effectMetrics = yield* OtelMetrics.makeProducer().pipe(
        Effect.provide(Resource.layer({ serviceName: config.otelServiceName }))
      );
      const transport = transports.options;
      const acquireSdk = Effect.gen(function* () {
        const sdk = yield* Effect.try({
          try: () =>
            new NodeSDK({
              serviceName: config.otelServiceName,
              spanProcessors: [
                new BatchSpanProcessor(
                  transports.monitor(
                    new OTLPTraceExporter({ ...transport, url: `${endpoint}/v1/traces` })
                  ),
                  telemetryBatchOptions
                ),
              ],
              logRecordProcessors: [
                new sdkLogs.BatchLogRecordProcessor({
                  exporter: transports.monitor(
                    new OTLPLogExporter({ ...transport, url: `${endpoint}/v1/logs` })
                  ),
                  ...telemetryBatchOptions,
                }),
              ],
              metricReaders: [
                new PeriodicExportingMetricReader({
                  metricProducers: [effectMetrics],
                  exporter: transports.monitor(
                    new OTLPMetricExporter({ ...transport, url: `${endpoint}/v1/metrics` })
                  ),
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
        }).pipe(Effect.onError(() => shutdownSdk(sdk, transports)));
        return sdk;
      });
      yield* Effect.acquireRelease(
        acquireSdk.pipe(Effect.onError(() => Effect.promise(() => transports.close()))),
        (sdk) => shutdownSdk(sdk, transports)
      );
      return { _tag: 'Started' } as const;
    });
    return yield* initialize.pipe(
      Effect.catchTag('OtelInitializationError', (error) =>
        Effect.logWarning('Variant generator telemetry initialization failed', {
          cause: error.cause,
        }).pipe(Effect.as<OtelStatus>({ _tag: 'Unavailable' }))
      )
    );
  }
);
