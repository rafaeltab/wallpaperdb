import { MinioConnection as CoreMinioConnection } from '@wallpaperdb/core/connections';
import { inject, singleton } from 'tsyringe';
import type { Config } from '../config.js';

/**
 * Variant-generator service-specific MinIO connection.
 * Extends the core MinioConnection with service-specific configuration.
 *
 * Used for:
 * - Reading original wallpaper files
 * - Uploading generated variant files
 */
@singleton()
export class MinioConnection extends CoreMinioConnection {
  constructor(@inject('config') config: Config) {
    super(config);
  }
}
