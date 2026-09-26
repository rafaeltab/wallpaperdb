import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { OtelMetrics, Resource } from '@effect/opentelemetry';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { logs as sdkLogs, NodeSDK } from '@opentelemetry/sdk-node';
import { Cause, Effect, Schema, type Scope } from 'effect';

export type OtelStatus =
  | { readonly _tag: 'Disabled' }
  | { readonly _tag: 'Started' }
  | { readonly _tag: 'Unavailable' };

class OtelInitializationError extends Schema.TaggedError<OtelInitializationError>()(
  'OtelInitializationError',
  { cause: Schema.Defect() }
) {}

const exportTimeoutMillis = 1000;

/** Keep useful error fields while excluding raw inputs, response bodies, stacks and nested objects. */
function diagnostic(cause: unknown, endpoint: string) {
  const error = Cause.isUnknownError(cause) ? cause.cause : cause;
  if (!(error instanceof Error)) return { name: 'UnknownError' };
  const redact = redactEndpoint(endpoint);
  return {
    name: redact(error.name),
    message: redact(error.message),
    ...('code' in error && (typeof error.code === 'string' || typeof error.code === 'number')
      ? { code: typeof error.code === 'string' ? redact(error.code) : error.code }
      : {}),
  };
}

function redactEndpoint(endpoint: string) {
  const sensitive = [endpoint];
  try {
    const url = new URL(endpoint);
    for (const value of [url.username, url.password, ...url.searchParams.values()]) {
      if (value) {
        sensitive.push(value);
        try {
          sensitive.push(decodeURIComponent(value));
        } catch {
          // An invalid escape in one value must not stop redaction of the other credentials.
        }
      }
    }
  } catch {
    // Malformed endpoint errors still exclude their raw input and redact the complete endpoint.
  }
  sensitive.sort((left, right) => right.length - left.length);
  return (message: string) => {
    let safe = message.replace(/\b[a-z][a-z\d+.-]*:\/\/[^\s"'<>)]*/gi, '[redacted URL]');
    for (const value of sensitive) safe = safe.replaceAll(value, '[redacted]');
    return safe.replace(/\p{Cc}/gu, ' ').slice(0, 512);
  };
}

const shutdownSdk = (sdk: NodeSDK, endpoint: string) =>
  Effect.tryPromise(() => sdk.shutdown()).pipe(
    Effect.interruptible,
    Effect.timeout('4 seconds'),
    Effect.catch((error) =>
      Effect.logWarning('Tags telemetry shutdown failed', {
        cause: diagnostic(error, endpoint),
      })
    )
  );

/** Initialize before loading adapters so auto-instrumentation sees their first imports. */
export const initializeOtel = Effect.fn('tags.telemetry.initialize')(function* (config: {
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
    // Exporter deadlines can leave streaming responses open, so the scope owns their sockets too.
    const agent = yield* Effect.acquireRelease(
      Effect.sync(() =>
        url.protocol === 'https:'
          ? new HttpsAgent({ keepAlive: false, maxTotalSockets: 3 })
          : new HttpAgent({ keepAlive: false, maxTotalSockets: 3 })
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
      }).pipe(Effect.onError(() => shutdownSdk(sdk, endpoint)));
      return sdk;
    });
    yield* Effect.acquireRelease(acquireSdk, (sdk) => shutdownSdk(sdk, endpoint));
    return { _tag: 'Started' } as const;
  });
  return yield* initialize.pipe(
    Effect.catchTag('OtelInitializationError', (error) =>
      Effect.logWarning('Tags telemetry initialization failed', {
        cause: diagnostic(error.cause, endpoint),
      }).pipe(Effect.as<OtelStatus>({ _tag: 'Unavailable' }))
    )
  );
});
