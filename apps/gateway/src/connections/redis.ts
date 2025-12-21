import { RedisConnection as CoreRedisConnection } from '@wallpaperdb/core/connections';
import { inject, singleton } from 'tsyringe';
import type { Config } from '../config.js';

/**
 * Gateway-specific Redis connection (extends core connection)
 */
@singleton()
export class RedisConnection extends CoreRedisConnection {
  constructor(@inject('config') config: Config) {
    super({
      redisHost: config.redisHost,
      redisPort: config.redisPort,
      redisPassword: config.redisPassword,
      redisEnabled: config.redisEnabled,
    });
  }
}
