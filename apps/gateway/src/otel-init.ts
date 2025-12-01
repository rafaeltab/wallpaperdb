import type { NodeSDK } from '@opentelemetry/sdk-node';
import { createOtelSdk } from '@wallpaperdb/core/connections';
import type { OtelConfig } from '@wallpaperdb/core/config';

/**
 * Global reference to the OTEL SDK instance.
 * Set during early initialization in index.ts.
 * Used later when registering with TSyringe container.
 */
let otelSdkInstance: NodeSDK | null = null;

/**
 * Initialize OpenTelemetry SDK immediately (before any instrumented modules are imported).
 *
 * CRITICAL: This MUST be called at the very top of index.ts, before importing app.ts
 * or any other modules. Auto-instrumentations only work when NodeSDK.start() is called
 * before the modules they instrument are loaded.
 *
 * @param config - OTEL configuration containing endpoint and service name
 * @returns The initialized SDK instance (also stored globally), or null if disabled
 *
 * @example
 * ```typescript
 * // In index.ts, at the very top:
 * import { initializeOtel } from './otel-init.js';
 * const otelSdk = initializeOtel(config);
 * ```
 */
export function initializeOtel(config: OtelConfig): NodeSDK | null {
  // Skip if no endpoint configured (tests, or when OTEL is disabled)
  if (!config.otelEndpoint) {
    console.log('OpenTelemetry disabled (no endpoint configured)');
    return null;
  }

  // Return existing instance if already initialized
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
    // Continue without OTEL - don't crash the app
    return null;
  }
}

/**
 * Get the OTEL SDK instance (for registration in container).
 * Safe to call after initializeOtel().
 */
export function getOtelSdk(): NodeSDK | null {
  return otelSdkInstance;
}

/**
 * Shutdown the OTEL SDK gracefully.
 * Called during app shutdown in app.ts onClose hook.
 */
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
