import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import type { Config } from '../config.js';
import { BaseConnection } from './base/base-connection.js';

class OpenTelemetryConnection extends BaseConnection<NodeSDK> {
  protected createClient(config: Config): NodeSDK {
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

  protected async closeClient(client: NodeSDK): Promise<void> {
    await client.shutdown();
    console.log('OpenTelemetry shut down');
  }

  async checkHealth(_client: NodeSDK, _config: Config): Promise<boolean> {
    // OTEL doesn't have a direct health check
    // We assume it's healthy if it's initialized
    return true;
  }
}

// Singleton instance
const otelConnection = new OpenTelemetryConnection();

export function initializeOpenTelemetry(config: Config): NodeSDK {
  if (otelConnection.isInitialized()) {
    return otelConnection.getClient();
  }

  const client = otelConnection['createClient'](config);
  otelConnection['client'] = client;
  return client;
}

export async function checkOtelHealth(): Promise<boolean> {
  if (!otelConnection.isInitialized()) {
    return false;
  }
  return await otelConnection.checkHealth(otelConnection.getClient(), {} as Config);
}

export async function shutdownOpenTelemetry(): Promise<void> {
  await otelConnection.close();
}

// Export the connection instance for DI usage
export { otelConnection };
