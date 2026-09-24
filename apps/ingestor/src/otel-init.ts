import type { Agent } from 'node:http';
import type { Duplex } from 'node:stream';
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

class TelemetryTransports {
  private readonly agents = new Set<Agent>();
  private readonly sockets = new Set<Duplex>();
  private closed = false;

  readonly agent = async (protocol: string): Promise<Agent> => {
    const AgentConstructor: typeof Agent = (
      await (protocol === 'http:' ? import('node:http') : import('node:https'))
    ).Agent;
    const { Socket } = await import('node:net');
    const owner = this;
    const agent = new (class extends AgentConstructor {
      override createConnection(...args: Parameters<Agent['createConnection']>) {
        if (owner.closed) {
          const socket = new Socket();
          queueMicrotask(() => socket.destroy(new Error('Ingestor telemetry is closed')));
          return socket;
        }
        const socket = super.createConnection(...args);
        if (socket) {
          owner.sockets.add(socket);
          const deadline = setTimeout(
            () => socket.destroy(new Error('Ingestor telemetry export deadline exceeded')),
            exportTimeoutMillis
          );
          socket.once('close', () => {
            clearTimeout(deadline);
            owner.sockets.delete(socket);
          });
        }
        return socket;
      }
    })({ keepAlive: false });
    this.agents.add(agent);
    return agent;
  };

  readonly close = Effect.fnUntraced(function* (this: TelemetryTransports): Effect.fn.Return<void> {
    this.closed = true;
    yield* Effect.forEach(
      [...this.sockets],
      (socket) =>
        Effect.callback<void>((resume) => {
          const closed = () => resume(Effect.void);
          socket.once('close', closed);
          socket.destroy();
          return Effect.sync(() => socket.removeListener('close', closed));
        }),
      { concurrency: 'unbounded' }
    );
    for (const agent of this.agents) agent.destroy();
  });
}

const shutdownSdk = Effect.fn('ingestor.telemetry.shutdown')(function* (
  sdk: NodeSDK,
  transports: TelemetryTransports
) {
  yield* Effect.tryPromise(() => sdk.shutdown()).pipe(
    Effect.interruptible,
    Effect.timeout('4 seconds'),
    Effect.catch(() => Effect.logWarning('Ingestor telemetry shutdown failed')),
    Effect.ensuring(transports.close())
  );
});

/** Must run before loading adapters so auto-instrumentation observes their first imports. */
export const initializeOtel = Effect.fn('ingestor.telemetry.initialize')(function* (config: {
  readonly otelEndpoint?: string;
  readonly otelServiceName: string;
}): Effect.fn.Return<OtelStatus, never, Scope.Scope> {
  if (!config.otelEndpoint) return { _tag: 'Disabled' };
  const endpoint = config.otelEndpoint.replace(/\/+$/, '');
  const transports = yield* Effect.acquireRelease(
    Effect.sync(() => new TelemetryTransports()),
    (transports) => transports.close()
  );
  const acquire = Effect.gen(function* () {
    const effectMetrics = yield* OtelMetrics.makeProducer().pipe(
      Effect.provide(Resource.layer({ serviceName: config.otelServiceName }))
    );
    const sdk = yield* Effect.try({
      try: () =>
        new NodeSDK({
          serviceName: config.otelServiceName,
          logRecordProcessors: [
            new sdkLogs.BatchLogRecordProcessor({
              exporter: new OTLPLogExporter({
                url: `${endpoint}/v1/logs`,
                timeoutMillis: exportTimeoutMillis,
                httpAgentOptions: transports.agent,
              }),
              exportTimeoutMillis,
            }),
          ],
          traceExporter: new OTLPTraceExporter({
            url: `${endpoint}/v1/traces`,
            timeoutMillis: exportTimeoutMillis,
            httpAgentOptions: transports.agent,
          }),
          metricReaders: [
            new PeriodicExportingMetricReader({
              metricProducers: [effectMetrics],
              exporter: new OTLPMetricExporter({
                url: `${endpoint}/v1/metrics`,
                timeoutMillis: exportTimeoutMillis,
                httpAgentOptions: transports.agent,
              }),
              exportIntervalMillis: 60000,
              exportTimeoutMillis,
            }),
          ],
          instrumentations: [
            getNodeAutoInstrumentations({
              '@opentelemetry/instrumentation-fs': { enabled: false },
              '@opentelemetry/instrumentation-ioredis': {
                // Quota keys identify Profiles; dependency diagnostics need only the command.
                dbStatementSerializer: (command) => command,
              },
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
      Effect.logWarning('Ingestor telemetry initialization failed').pipe(
        Effect.as<OtelStatus>({ _tag: 'Unavailable' })
      )
    )
  );
});
