import Redis from "ioredis";
import type { RedisConfig } from "./types.js";

export interface RedisClientOptions {
  /** Max retries per request (default: 3) */
  maxRetriesPerRequest?: number;
  /** Enable offline queue (default: false for fail-fast) */
  enableOfflineQueue?: boolean;
  /** Use lazy connect (default: true) */
  lazyConnect?: boolean;
}

/**
 * Creates a Redis client with sensible defaults.
 *
 * @example
 * ```typescript
 * import { createRedisClient } from '@wallpaperdb/core/connections';
 *
 * const redis = await createRedisClient({
 *   redisHost: config.redisHost,
 *   redisPort: config.redisPort,
 *   redisPassword: config.redisPassword,
 *   redisEnabled: config.redisEnabled,
 * });
 * ```
 */
export async function createRedisClient(
  config: RedisConfig,
  options: RedisClientOptions = {}
): Promise<Redis> {
  if (!config.redisEnabled) {
    throw new Error("Redis is not enabled");
  }

  const client = new Redis({
    host: config.redisHost,
    port: config.redisPort,
    password: config.redisPassword,
    maxRetriesPerRequest: options.maxRetriesPerRequest ?? 3,
    enableOfflineQueue: options.enableOfflineQueue ?? false,
    retryStrategy: (times) => {
      if (times > 3) {
        return null; // Stop retrying after 3 attempts
      }
      return Math.min(times * 100, 2000); // Exponential backoff (max 2s)
    },
    lazyConnect: options.lazyConnect ?? true,
  });

  // Explicitly connect since we use lazyConnect: true by default
  if (options.lazyConnect !== false) {
    await client.connect();
  }

  return client;
}

/**
 * Checks if a Redis client is healthy.
 */
export async function checkRedisHealth(client: Redis): Promise<boolean> {
  try {
    await client.ping();
    return true;
  } catch {
    return false;
  }
}

/**
 * Safely closes a Redis client.
 */
export async function closeRedisClient(client: Redis): Promise<void> {
  if (client.status === "end" || client.status === "close") {
    return;
  }

  try {
    if (client.status === "ready" || client.status === "connecting") {
      await client.quit();
    } else {
      client.disconnect();
    }
  } catch {
    client.disconnect();
  }
}
