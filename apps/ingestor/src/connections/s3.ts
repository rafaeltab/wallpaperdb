import { S3Connection as CoreS3Connection } from '@wallpaperdb/core/connections';
import { inject, singleton } from 'tsyringe';
import type { Config } from '../config.js';

/**
 * Ingestor-specific S3 connection.
 * Extends the core S3Connection with service-specific configuration.
 */
@singleton()
export class S3Connection extends CoreS3Connection {
  constructor(@inject('config') config: Config) {
    super(config);
  }
}
