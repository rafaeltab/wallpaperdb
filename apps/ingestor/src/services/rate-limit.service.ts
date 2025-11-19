import { inject, injectable } from 'tsyringe';
import type { Config } from '../config.js';
import { RedisConnection } from '../connections/redis.js';

@injectable()
export class RateLimitService {
  constructor(
    @inject("config") private readonly config: Config,
    @inject(RedisConnection) private readonly redisConnection: RedisConnection
  ) {
  }

  /**
   * Check if a user has exceeded their rate limit
   * Returns the number of remaining requests, or throws if limit exceeded
   */
  async checkRateLimit(userId: string): Promise<{ remaining: number; reset: number }> {
    const key = `wallpaperdb:ratelimit:user:${userId}`;
    const now = Date.now();
    const windowMs = this.config.rateLimitWindowMs;
    const max = this.config.rateLimitMax;

    const redis = this.redisConnection.isInitialized() ? this.redisConnection.getClient() : undefined;

    if (redis) {
      // Use Redis for distributed rate limiting with atomic Lua script
      // This ensures the increment, expiry, and limit check are all atomic to prevent race conditions
      const luaScript = `
        local key = KEYS[1]
        local max = tonumber(ARGV[1])
        local windowMs = tonumber(ARGV[2])

        -- Get current count (without incrementing yet)
        local current = redis.call('GET', key)
        local count = current and tonumber(current) or 0

        -- Check if limit exceeded BEFORE incrementing
        if count >= max then
          local ttl = redis.call('PTTL', key)
          return {-1, ttl}  -- Return -1 to indicate rate limit exceeded
        end

        -- Increment the counter
        count = redis.call('INCR', key)

        -- Set expiry on first request
        if count == 1 then
          redis.call('PEXPIRE', key, windowMs)
        end

        local ttl = redis.call('PTTL', key)
        return {count, ttl}
      `;

      const result = await redis.eval(luaScript, 1, key, max, windowMs) as [number, number];
      const [count, ttl] = result;

      const reset = now + (ttl > 0 ? ttl : windowMs);

      // Count of -1 means rate limit exceeded
      if (count === -1) {
        throw new RateLimitExceededError(max, windowMs, Math.ceil((reset - now) / 1000), reset);
      }

      return {
        remaining: Math.max(0, max - count),
        reset,
      };
    } else {
      // In-memory fallback (not distributed, for testing only)
      // This is a simplified implementation
      const globalWithStore = global as typeof global & {
        __rateLimitStore?: Map<string, { count: number; resetTime: number }>;
      };
      if (!globalWithStore.__rateLimitStore) {
        globalWithStore.__rateLimitStore = new Map();
      }
      const inMemoryStore = globalWithStore.__rateLimitStore;

      const record = inMemoryStore.get(key) || { count: 0, resetTime: now + windowMs };

      // Reset if window expired
      if (now >= record.resetTime) {
        record.count = 0;
        record.resetTime = now + windowMs;
      }

      record.count++;
      inMemoryStore.set(key, record);

      if (record.count > max) {
        throw new RateLimitExceededError(
          max,
          windowMs,
          Math.ceil((record.resetTime - now) / 1000),
          record.resetTime
        );
      }

      return {
        remaining: Math.max(0, max - record.count),
        reset: record.resetTime,
      };
    }
  }
}

export class RateLimitExceededError extends Error {
  constructor(
    public max: number,
    public windowMs: number,
    public retryAfter: number,
    public reset: number
  ) {
    super('Rate limit exceeded');
    this.name = 'RateLimitExceededError';
  }
}
