import { OtelConnection } from '@wallpaperdb/core/connections';
import { inject, singleton } from 'tsyringe';
import type { Config } from '../config.js';

/**
 * OpenTelemetry connection for the media service.
 * Uses the shared OtelConnection from @wallpaperdb/core.
 */
@singleton()
export class OpenTelemetryConnection extends OtelConnection {
  constructor(@inject('config') config: Config) {
    super(config, {
      metricExportIntervalMs: 60000,
      disableFsInstrumentation: true,
      enableLogging: true,
    });
  }
}
