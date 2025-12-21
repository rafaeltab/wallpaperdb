import crypto from 'node:crypto';
import { inject, singleton } from 'tsyringe';
import type { Config } from '../config.js';
import { RedisConnection } from '../connections/redis.js';
import { RateLimitExceededError } from '../errors/graphql-errors.js';

export interface RateLimitResult {
  remaining: number;
  reset: number;
}

/**
 * Service for GraphQL rate limiting with IP + user-agent fingerprinting
 */
@singleton()
export class GraphQLRateLimitService {
  constructor(
    @inject('config') private readonly config: Config,
    @inject(RedisConnection) private readonly redis: RedisConnection
  ) {}

  /**
   * Check rate limit for a request
   * @param ip - Client IP address
   * @param userAgent - Optional User-Agent header for fingerprinting
   */
  async checkRateLimit(ip: string, userAgent?: string): Promise<RateLimitResult> {
    if (!this.config.rateLimitEnabled) {
      // Rate limiting disabled
      return {
        remaining: this.config.rateLimitMaxAnonymous,
        reset: Date.now() + this.config.rateLimitWindowMs,
      };
    }

    const key = this.getRateLimitKey(ip, userAgent);
    const max = this.config.rateLimitMaxAnonymous;
    const windowMs = this.config.rateLimitWindowMs;

    const redis = this.redis.isInitialized() ? this.redis.getClient() : undefined;

    if (redis) {
      // Use Redis for distributed rate limiting with atomic Lua script
      const luaScript = `
        local key = KEYS[1]
        local max = tonumber(ARGV[1])
        local windowMs = tonumber(ARGV[2])
        
        local current = redis.call('GET', key)
        local count = current and tonumber(current) or 0
        
        if count >= max then
          local ttl = redis.call('PTTL', key)
          return {-1, ttl}
        end
        
        count = redis.call('INCR', key)
        if count == 1 then
          redis.call('PEXPIRE', key, windowMs)
        end
        
        local ttl = redis.call('PTTL', key)
        return {count, ttl}
      `;

      const result = (await redis.eval(luaScript, 1, key, max, windowMs)) as [number, number];
      const [count, ttl] = result;

      if (count === -1) {
        throw new RateLimitExceededError(max, windowMs, ttl);
      }

      return {
        remaining: max - count,
        reset: Date.now() + ttl,
      };
    }

    // In-memory fallback (for testing without Redis)
    return this.inMemoryRateLimit(key, max, windowMs);
  }

  /**
   * Generate rate limit key with IP + user-agent fingerprint
   */
  private getRateLimitKey(ip: string, userAgent?: string): string {
    if (!userAgent) {
      return `graphql:ratelimit:ip:${ip}`;
    }

    // Hash user-agent to prevent key explosion
    const uaHash = crypto.createHash('sha256').update(userAgent).digest('hex').slice(0, 8);

    return `graphql:ratelimit:ip:${ip}:ua:${uaHash}`;
  }

  /**
   * In-memory rate limiting fallback (for testing)
   */
  private inMemoryRateLimit(key: string, max: number, windowMs: number): RateLimitResult {
    const globalWithStore = global as typeof global & {
      __rateLimitStore?: Map<string, { count: number; resetTime: number }>;
    };

    if (!globalWithStore.__rateLimitStore) {
      globalWithStore.__rateLimitStore = new Map();
    }

    const store = globalWithStore.__rateLimitStore;
    const now = Date.now();
    const record = store.get(key) || { count: 0, resetTime: now + windowMs };

    // Reset if window expired
    if (now >= record.resetTime) {
      record.count = 0;
      record.resetTime = now + windowMs;
    }

    record.count++;
    store.set(key, record);

    if (record.count > max) {
      throw new RateLimitExceededError(max, windowMs, record.resetTime - now);
    }

    return {
      remaining: max - record.count,
      reset: record.resetTime,
    };
  }
}
