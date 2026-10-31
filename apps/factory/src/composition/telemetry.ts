import * as OtelTracer from '@effect/opentelemetry/OtelTracer';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BasicTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { TelemetryExportTransport, telemetryBatchOptions } from '@wallpaperdb/core/telemetry';
import { Effect, Layer } from 'effect';
/** A local provider keeps factory telemetry independent of product processes and
 * of other runtimes in the same process. Export transport owns bounded sockets. */
export function telemetry(endpoint: string | undefined) {
  return Layer.unwrap(
    Effect.gen(function* () {
      if (!endpoint) return Layer.empty;
      const transport = yield* Effect.acquireRelease(
        Effect.sync(() => new TelemetryExportTransport()),
        (resource) => Effect.promise(() => resource.close())
      );
      const provider = yield* Effect.acquireRelease(
        Effect.sync(
          () =>
            new BasicTracerProvider({
              resource: resourceFromAttributes({ 'service.name': 'wallpaperdb.factory' }),
              spanProcessors: [
                new BatchSpanProcessor(
                  transport.monitor(
                    new OTLPTraceExporter({
                      ...transport.options,
                      url: `${endpoint.replace(/\/+$/, '')}/v1/traces`,
                    })
                  ),
                  telemetryBatchOptions
                ),
              ],
            })
        ),
        (resource) =>
          Effect.tryPromise(() => resource.shutdown()).pipe(
            Effect.timeout('4 seconds'),
            Effect.catch(() => Effect.logWarning('Factory telemetry shutdown unavailable'))
          )
      );
      return OtelTracer.layerWithoutOtelTracer.pipe(
        Layer.provide(
          Layer.succeed(OtelTracer.OtelTracer, provider.getTracer('wallpaperdb.factory'))
        )
      );
    })
  );
}
