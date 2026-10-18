import { randomUUID } from 'node:crypto';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  TelemetryExportTransport,
  telemetryBatchOptions,
  telemetryExportTimeoutMillis,
} from '@wallpaperdb/core/telemetry';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
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

const shutdownSdk = Effect.fn('gateway.telemetry.shutdown')(function* (
  sdk: NodeSDK,
  transports: TelemetryExportTransport
) {
  yield* Effect.tryPromise(() => sdk.shutdown()).pipe(
    Effect.interruptible,
    Effect.timeout('4 seconds'),
    Effect.catch(() => Effect.logWarning('Gateway telemetry shutdown failed')),
    Effect.ensuring(Effect.promise(() => transports.close()))
  );
});

/** Must run before loading adapters so auto-instrumentation observes their first imports. */
export const initializeOtel = Effect.fn('gateway.telemetry.initialize')(function* (config: {
  readonly otelEndpoint?: string;
  readonly otelServiceName: string;
}): Effect.fn.Return<OtelStatus, never, Scope.Scope> {
  if (!config.otelEndpoint) return { _tag: 'Disabled' };
  const endpoint = config.otelEndpoint.replace(/\/+$/, '');
  const transports = yield* Effect.acquireRelease(
    Effect.sync(() => new TelemetryExportTransport()),
    (transports) => Effect.promise(() => transports.close())
  );
  const acquire = Effect.gen(function* () {
    const sdk = yield* Effect.try({
      try: () =>
        new NodeSDK({
          serviceName: config.otelServiceName,
          resource: resourceFromAttributes({ 'service.instance.id': randomUUID() }),
          logRecordProcessors: [
            new sdkLogs.BatchLogRecordProcessor({
              exporter: transports.monitor(
                new OTLPLogExporter({
                  url: `${endpoint}/v1/logs`,
                  ...transports.options,
                })
              ),
              ...telemetryBatchOptions,
            }),
          ],
          spanProcessors: [
            new BatchSpanProcessor(
              transports.monitor(
                new OTLPTraceExporter({
                  url: `${endpoint}/v1/traces`,
                  ...transports.options,
                })
              ),
              telemetryBatchOptions
            ),
          ],
          metricReaders: [
            new PeriodicExportingMetricReader({
              exporter: transports.monitor(
                new OTLPMetricExporter({
                  url: `${endpoint}/v1/metrics`,
                  ...transports.options,
                })
              ),
              exportIntervalMillis: 10000,
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
  return yield* Effect.acquireRelease(acquire, (sdk) => shutdownSdk(sdk, transports)).pipe(
    Effect.as<OtelStatus>({ _tag: 'Started' }),
    Effect.catchTag('OtelInitializationError', () =>
      Effect.logWarning('Gateway telemetry initialization failed').pipe(
        Effect.as<OtelStatus>({ _tag: 'Unavailable' })
      )
    )
  );
});
