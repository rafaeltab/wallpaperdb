import { RedisConnection as CoreRedisConnection } from '@wallpaperdb/core/connections';
import { inject, singleton } from 'tsyringe';
import type { Config } from '../config.js';

/**
 * Ingestor service-specific Redis connection.
 * Extends the core RedisConnection with service-specific configuration.
 */
@singleton()
export class RedisConnection extends CoreRedisConnection {
  constructor(@inject('config') config: Config) {
    super(config);
  }
}
