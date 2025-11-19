import Redis from 'ioredis';
import type { Config } from '../config.js';
import { BaseConnection } from './base/base-connection.js';

class RedisConnection extends BaseConnection<Redis> {
  protected createClient(config: Config): Redis {
    if (!config.redisEnabled) {
      throw new Error('Redis is not enabled');
    }

    const client = new Redis({
      host: config.redisHost,
      port: config.redisPort,
      password: config.redisPassword,
      maxRetriesPerRequest: 3,
      enableOfflineQueue: false, // Fail fast if Redis unavailable
      retryStrategy: (times) => {
        if (times > 3) {
          return null; // Stop retrying after 3 attempts
        }
        return Math.min(times * 100, 2000); // Exponential backoff (max 2s)
      },
      lazyConnect: true, // Don't connect until explicitly called
    });

    client.on('error', (err) => {
      console.error('Redis connection error:', err);
    });

    client.on('connect', () => {
      console.log('Redis connected successfully');
    });

    client.on('close', () => {
      console.log('Redis connection closed');
    });

    return client;
  }

  protected async closeClient(client: Redis): Promise<void> {
    await client.quit();
  }

  async checkHealth(client: Redis, _config: Config): Promise<boolean> {
    try {
      await client.ping();
      return true;
    } catch (error) {
      console.error('Redis health check failed:', error);
      return false;
    }
  }
}

// Singleton instance
const redisConnection = new RedisConnection();

/**
 * Create Redis connection for distributed rate limiting
 */
export function createRedisConnection(config: Config): Redis {
  if (redisConnection.isInitialized()) {
    return redisConnection.getClient();
  }

  const client = redisConnection['createClient'](config);
  redisConnection['client'] = client;
  return client;
}

export function getRedis(): Redis {
  return redisConnection.getClient();
}

export async function closeRedisConnection(): Promise<void> {
  await redisConnection.close();
}

// Export the connection instance for DI usage
export { redisConnection };
