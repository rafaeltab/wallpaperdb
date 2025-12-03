import { MinioConnection as CoreMinioConnection } from '@wallpaperdb/core/connections';
import { inject, singleton } from 'tsyringe';
import type { Config } from '../config.js';

/**
 * Media service-specific MinIO connection.
 * Extends the core MinioConnection with service-specific configuration.
 */
@singleton()
export class MinioConnection extends CoreMinioConnection {
  constructor(@inject('config') config: Config) {
    super(config);
  }
}
