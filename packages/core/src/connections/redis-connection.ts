import Redis from "ioredis";
import { BaseConnection } from "./base/base-connection.js";
import type { RedisConfig } from "./types.js";

export interface RedisConnectionOptions {
  /** Max retries per request (default: 3) */
  maxRetriesPerRequest?: number;
  /** Enable offline queue (default: false for fail-fast) */
  enableOfflineQueue?: boolean;
  /** Use lazy connect (default: true) */
  lazyConnect?: boolean;
}

/**
 * Redis connection manager.
 * Extends BaseConnection to provide lifecycle management for Redis client.
 *
 * @example
 * ```typescript
 * const connection = new RedisConnection(config);
 * await connection.initialize();
 *
 * const client = connection.getClient();
 * await client.set('key', 'value');
 *
 * await connection.close();
 * ```
 */
export class RedisConnection extends BaseConnection<Redis, RedisConfig> {
  constructor(
    config: RedisConfig,
    private readonly options: RedisConnectionOptions = {}
  ) {
    super(config);
  }

  protected async createClient(): Promise<Redis> {
    if (!this.config.redisEnabled) {
      throw new Error("Redis is not enabled");
    }

    console.log(`Connecting to Redis at '${this.config.redisHost}:${this.config.redisPort}'`);

    const client = new Redis({
      host: this.config.redisHost,
      port: this.config.redisPort,
      password: this.config.redisPassword,
      maxRetriesPerRequest: this.options.maxRetriesPerRequest ?? 3,
      enableOfflineQueue: this.options.enableOfflineQueue ?? false,
      retryStrategy: (times) => {
        if (times > 3) {
          return null; // Stop retrying after 3 attempts
        }
        return Math.min(times * 100, 2000); // Exponential backoff (max 2s)
      },
      lazyConnect: this.options.lazyConnect ?? true,
    });

    client.on("error", (err) => {
      console.error("Redis connection error:", err);
    });

    client.on("connect", () => {
      console.log("Redis connected successfully");
    });

    client.on("close", () => {
      console.log("Redis connection closed");
    });

    // Explicitly connect since we use lazyConnect: true by default
    if (this.options.lazyConnect !== false) {
      await client.connect();
    }

    return client;
  }

  protected async closeClient(client: Redis): Promise<void> {
    // Check if client is in a state where it can be closed
    if (client.status === "end" || client.status === "close") {
      return; // Already closed
    }

    try {
      // Only quit if connected or ready
      if (client.status === "ready" || client.status === "connecting") {
        await client.quit();
      } else {
        // Force disconnect for other states
        client.disconnect();
      }
    } catch (error) {
      // If quit fails, force disconnect
      console.warn("Redis quit failed, forcing disconnect:", error);
      client.disconnect();
    }
  }

  /**
   * Check Redis connection health by pinging the server.
   *
   * @returns true if ping succeeds, false otherwise
   */
  async checkHealth(): Promise<boolean> {
    try {
      await this.getClient().ping();
      return true;
    } catch (error) {
      console.error("Redis health check failed:", error);
      return false;
    }
  }
}
