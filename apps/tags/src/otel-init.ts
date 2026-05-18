import type { NodeSDK } from '@opentelemetry/sdk-node';
import type { OtelConfig } from '@wallpaperdb/core/config';
import { createOtelSdk } from '@wallpaperdb/core/connections';

let otelSdkInstance: NodeSDK | null = null;

export function initializeOtel(config: OtelConfig): NodeSDK | null {
  if (!config.otelEndpoint) {
    console.log('OpenTelemetry disabled (no endpoint configured)');
    return null;
  }

  if (otelSdkInstance) {
    return otelSdkInstance;
  }

  try {
    otelSdkInstance = createOtelSdk(config as Required<OtelConfig>, {
      metricExportIntervalMs: 60000,
      disableFsInstrumentation: true,
    });
    console.log('OpenTelemetry initialized (auto-instrumentations active)');
    return otelSdkInstance;
  } catch (error) {
    console.error('Failed to initialize OpenTelemetry:', error);
    return null;
  }
}

export function getOtelSdk(): NodeSDK | null {
  return otelSdkInstance;
}

export async function shutdownOtel(): Promise<void> {
  if (otelSdkInstance) {
    try {
      await otelSdkInstance.shutdown();
      console.log('OpenTelemetry shut down');
      otelSdkInstance = null;
    } catch (error) {
      console.error('Error shutting down OpenTelemetry:', error);
    }
  }
}
