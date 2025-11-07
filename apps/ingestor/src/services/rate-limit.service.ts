import type Redis from 'ioredis';
import type { Config } from '../config.js';

export class RateLimitService {
  constructor(
    private config: Config,
    private redis?: Redis
  ) {}

  /**
   * Check if a user has exceeded their rate limit
   * Returns the number of remaining requests, or throws if limit exceeded
   */
  async checkRateLimit(userId: string): Promise<{ remaining: number; reset: number }> {
    const key = `wallpaperdb:ratelimit:user:${userId}`;
    const now = Date.now();
    const windowMs = this.config.rateLimitWindowMs;
    const max = this.config.rateLimitMax;

    if (this.redis) {
      // Use Redis for distributed rate limiting
      const count = await this.redis.incr(key);

      // Set expiry on first request
      if (count === 1) {
        await this.redis.pexpire(key, windowMs);
      }

      const ttl = await this.redis.pttl(key);
      const reset = now + (ttl > 0 ? ttl : windowMs);

      if (count > max) {
        throw new RateLimitExceededError(max, windowMs, Math.ceil((reset - now) / 1000), reset);
      }

      return {
        remaining: Math.max(0, max - count),
        reset,
      };
    } else {
      // In-memory fallback (not distributed, for testing only)
      // This is a simplified implementation
      const inMemoryStore =
        (global as any).__rateLimitStore || ((global as any).__rateLimitStore = new Map());

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
