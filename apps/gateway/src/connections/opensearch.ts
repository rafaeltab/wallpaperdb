import { OpenSearchConnection as CoreOpenSearchConnection } from '@wallpaperdb/core/connections';
import { inject, singleton } from 'tsyringe';
import type { Config } from '../config.js';

/**
 * Gateway service-specific OpenSearch connection.
 * Extends the core OpenSearchConnection with service-specific configuration.
 */
@singleton()
export class OpenSearchConnection extends CoreOpenSearchConnection {
  constructor(@inject('config') config: Config) {
    super(config);
  }
}
