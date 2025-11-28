import { OtelConnection } from '@wallpaperdb/core/connections';
import type { NodeSDK } from '@opentelemetry/sdk-node';
import { inject, singleton } from 'tsyringe';
import type { Config } from '../config.js';
import { getOtelSdk } from '../otel-init.js';

/**
 * OpenTelemetry connection wrapper for the media service.
 *
 * NOTE: SDK initialization now happens in otel-init.ts at the top of index.ts.
 * This class is now primarily a DI container wrapper for accessing the initialized SDK.
 * Tests can skip OTEL initialization by not calling initializeOtel() in index.ts.
 */
@singleton()
export class OpenTelemetryConnection extends OtelConnection {
  constructor(@inject('config') config: Config) {
    // Cast config to ensure OtelConfig compatibility (endpoint is optional now)
    super(config as any, {
      metricExportIntervalMs: 60000,
      disableFsInstrumentation: true,
      enableLogging: true,
    });
  }

  /**
   * Initialize or return existing OTEL SDK.
   * In production: SDK already initialized in index.ts via initializeOtel().
   * In tests: SDK may not be initialized (no endpoint configured).
   *
   * @override Base class implementation to handle pre-initialized SDK
   */
  async initialize(): Promise<NodeSDK> {
    const sdk = getOtelSdk();
    if (sdk) {
      // SDK already initialized in index.ts - store reference and return
      this.client = sdk;
      return sdk;
    }
    // SDK not initialized (test mode or OTEL disabled)
    // Create a dummy SDK that does nothing to satisfy the return type
    // This is safe because tests don't use OTEL
    return null as any; // Type assertion is safe - tests won't actually use this
  }
}
