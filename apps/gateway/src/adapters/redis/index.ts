import Redis from 'ioredis';
import { Clock, Effect } from 'effect';
import { z } from 'zod';
import type { AdmissionResult, Quota } from '../../admission/index.js';

class MemoryQuota implements Quota {
  private readonly windows = new Map<string, { count: number; reset: number }>();
  take(visitor: string, limit: number, windowMs: number): Effect.Effect<AdmissionResult> {
    return Clock.currentTimeMillis.pipe(
      Effect.map((now): AdmissionResult => {
        for (const [key, window] of this.windows) {
          if (window.reset <= now) this.windows.delete(key);
        }
        const window = this.windows.get(visitor) ?? { count: 0, reset: now + windowMs };
        if (window.count >= limit) return { _tag: 'Limited', retryAfter: window.reset - now };
        window.count++;
        this.windows.set(visitor, window);
        return { _tag: 'Allowed', remaining: limit - window.count, reset: window.reset };
      })
    );
  }
}
export function createMemoryQuota(): Quota {
  return new MemoryQuota();
}

const consume = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
if count >= tonumber(ARGV[1]) then return {-1, redis.call('PTTL', KEYS[1])} end
count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
return {count, redis.call('PTTL', KEYS[1])}
`;
const response = z.tuple([z.number().int(), z.number().int().nonnegative()]);

export interface RedisQuotaConfig {
  readonly redisEnabled: boolean;
  readonly redisHost: string;
  readonly redisPort: number;
  readonly redisPassword?: string;
}
class RedisQuota implements Quota {
  private client: Redis | undefined;
  constructor(
    private readonly config: RedisQuotaConfig,
    private readonly fallback: Quota
  ) {}
  async start(): Promise<void> {
    if (!this.config.redisEnabled) return;
    const client = new Redis({
      host: this.config.redisHost,
      port: this.config.redisPort,
      password: this.config.redisPassword,
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
      connectTimeout: 2000,
    });
    client.on('error', () => {
      /* A failed quota read uses the local window. */
    });
    try {
      await client.connect();
      this.client = client;
    } catch {
      client.disconnect();
    }
  }
  async stop(): Promise<void> {
    if (this.client) this.client.disconnect();
    this.client = undefined;
  }
  take(visitor: string, limit: number, windowMs: number): Effect.Effect<AdmissionResult> {
    return Effect.gen(this, function* () {
      const client = this.client;
      if (!client) return yield* this.fallback.take(visitor, limit, windowMs);
      const reply = yield* Effect.tryPromise(() =>
        client.eval(consume, 1, `graphql:ratelimit:${visitor}`, limit, windowMs)
      ).pipe(Effect.timeout('2 seconds'), Effect.option);
      if (reply._tag === 'None') return yield* this.fallback.take(visitor, limit, windowMs);
      const decoded = response.safeParse(reply.value);
      if (!decoded.success) return yield* this.fallback.take(visitor, limit, windowMs);
      const [count, ttl] = decoded.data;
      if (count === -1) return { _tag: 'Limited', retryAfter: ttl } satisfies AdmissionResult;
      const now = yield* Clock.currentTimeMillis;
      return {
        _tag: 'Allowed',
        remaining: Math.max(0, limit - count),
        reset: now + ttl,
      } satisfies AdmissionResult;
    }).pipe(Effect.withSpan('admission.consume_quota'));
  }
}
export function createRedisQuota(
  config: RedisQuotaConfig
): Quota & { start(): Promise<void>; stop(): Promise<void> } {
  return new RedisQuota(config, createMemoryQuota());
}
