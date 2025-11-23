import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import type { OtelConfig } from "./types.js";

export interface OtelOptions {
  /** Metric export interval in ms (default: 60000) */
  metricExportIntervalMs?: number;
  /** Disable file system instrumentation (default: true - too noisy) */
  disableFsInstrumentation?: boolean;
}

/**
 * Creates and starts an OpenTelemetry SDK instance.
 *
 * @example
 * ```typescript
 * import { createOtelSdk } from '@wallpaperdb/core/connections';
 *
 * const sdk = createOtelSdk({
 *   otelEndpoint: config.otelEndpoint,
 *   otelServiceName: config.otelServiceName,
 * });
 * ```
 */
export function createOtelSdk(config: OtelConfig, options: OtelOptions = {}): NodeSDK {
  const traceExporter = new OTLPTraceExporter({
    url: `${config.otelEndpoint}/v1/traces`,
  });

  const metricExporter = new OTLPMetricExporter({
    url: `${config.otelEndpoint}/v1/metrics`,
  });

  const sdk = new NodeSDK({
    serviceName: config.otelServiceName,
    traceExporter,
    metricReader: new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: options.metricExportIntervalMs ?? 60000,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fs": {
          enabled: !(options.disableFsInstrumentation ?? true),
        },
      }),
    ],
  });

  sdk.start();
  return sdk;
}

/**
 * Shuts down an OpenTelemetry SDK instance.
 */
export async function shutdownOtelSdk(sdk: NodeSDK): Promise<void> {
  await sdk.shutdown();
}
