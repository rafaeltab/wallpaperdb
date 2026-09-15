import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';

/** Bootstrap owns the SDK and starts instrumentation before importing adapters. */
export function initializeOtel(config: {
  otelEndpoint?: string;
  otelServiceName: string;
}): NodeSDK | null {
  if (!config.otelEndpoint) return null;
  try {
    const endpoint = config.otelEndpoint.replace(/\/+$/, '');
    const sdk = new NodeSDK({
      serviceName: config.otelServiceName,
      traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
      metricReader: new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
        exportIntervalMillis: 60000,
      }),
      instrumentations: [
        getNodeAutoInstrumentations({ '@opentelemetry/instrumentation-fs': { enabled: false } }),
      ],
    });
    sdk.start();
    return sdk;
  } catch {
    return null;
  }
}
