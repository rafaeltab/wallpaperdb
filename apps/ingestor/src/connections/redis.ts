import Redis from 'ioredis';
import type { Config } from '../config.js';

let redis: Redis | null = null;

/**
 * Create Redis connection for distributed rate limiting
 */
export function createRedisConnection(config: Config): Redis {
  if (redis) {
    return redis;
  }

  if (!config.redisEnabled) {
    throw new Error('Redis is not enabled');
  }

  redis = new Redis({
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

  redis.on('error', (err) => {
    console.error('Redis connection error:', err);
  });

  redis.on('connect', () => {
    console.log('Redis connected successfully');
  });

  redis.on('close', () => {
    console.log('Redis connection closed');
  });

  return redis;
}

export function getRedis(): Redis {
  if (!redis) {
    throw new Error('Redis not initialized. Call createRedisConnection first.');
  }
  return redis;
}

export async function closeRedisConnection(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}
