import * as OtelLogger from '@effect/opentelemetry/OtelLogger';
import * as OtelTracer from '@effect/opentelemetry/OtelTracer';
import { trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { logs as sdkLogs } from '@opentelemetry/sdk-node';
import { Effect, Layer } from 'effect';

/** The process SDK owns the provider and exporters, including shutdown. */
const loggingLayer = Layer.unwrap(
  Effect.sync(() => {
    const provider = logs.getLoggerProvider();
    return provider instanceof sdkLogs.LoggerProvider
      ? OtelLogger.layer({ mergeWithExisting: false }).pipe(
          Layer.provide(Layer.succeed(OtelLogger.OtelLoggerProvider, provider))
        )
      : Layer.empty;
  })
);

/** The application graph reuses process telemetry without owning global SDK state. */
export const tracingLayer = Layer.merge(
  OtelTracer.layerWithoutOtelTracer.pipe(
    Layer.provide(
      Layer.sync(OtelTracer.OtelTracer, () => trace.getTracer('wallpaperdb.color-extractor'))
    )
  ),
  loggingLayer
);
