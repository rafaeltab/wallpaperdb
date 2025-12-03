import { OtelConnection } from '@wallpaperdb/core/connections';
import { inject, singleton } from 'tsyringe';
import type { Config } from '../config.js';
import { getOtelSdk } from '../otel-init.js';

/**
 * OpenTelemetry connection wrapper for the ingestor service.
 *
 * Wraps the pre-initialized SDK from otel-init.ts (Pattern B).
 * The SDK is initialized early in index.ts before any imports to enable auto-instrumentation.
 */
@singleton()
export class OpenTelemetryConnection extends OtelConnection {
  constructor(@inject('config') config: Config) {
    const existingSdk = getOtelSdk();
    if (!existingSdk) {
      throw new Error(
        'OTEL SDK must be initialized before creating OpenTelemetryConnection. ' +
          'Ensure initializeOtel() is called in index.ts before app imports.'
      );
    }

    super(config, {
      existingSdk,
      enableLogging: true,
    });
  }
}
