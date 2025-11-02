import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import type { Config } from '../config.js';

let sdk: NodeSDK | null = null;

export function initializeOpenTelemetry(config: Config): NodeSDK {
  if (sdk) {
    return sdk;
  }

  const traceExporter = new OTLPTraceExporter({
    url: `${config.otelEndpoint}/v1/traces`,
  });

  const metricExporter = new OTLPMetricExporter({
    url: `${config.otelEndpoint}/v1/metrics`,
  });

  sdk = new NodeSDK({
    serviceName: config.otelServiceName,
    traceExporter,
    metricReader: new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 60000, // Export every 60 seconds
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': {
          enabled: false, // Too noisy for file operations
        },
      }),
    ],
  });

  sdk.start();
  console.log('OpenTelemetry initialized');

  return sdk;
}

export async function checkOtelHealth(): Promise<boolean> {
  // OTEL doesn't have a direct health check
  // We assume it's healthy if it's initialized
  return sdk !== null;
}

export async function shutdownOpenTelemetry(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
    sdk = null;
    console.log('OpenTelemetry shut down');
  }
}
