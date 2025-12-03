import { DatabaseConnection as CoreDatabaseConnection } from '@wallpaperdb/core/connections';
import { inject, singleton } from 'tsyringe';
import type { Config } from '../config.js';
import * as schema from '../db/schema.js';

// Re-export the typed client for convenience
export type DatabaseClient = ReturnType<CoreDatabaseConnection<typeof schema>['getClient']>;

/**
 * Media service-specific database connection.
 * Extends the core DatabaseConnection with media schema and configuration.
 */
@singleton()
export class DatabaseConnection extends CoreDatabaseConnection<typeof schema> {
  constructor(@inject('config') config: Config) {
    super(config, schema);
  }
}
