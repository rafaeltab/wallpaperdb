import { recordCounter } from '@wallpaperdb/core/telemetry';
import { Clock, Effect, Layer, Queue, Schema, Semaphore, Stream } from 'effect';
import Redis from 'ioredis';
import { type AdmissionResult, Quota } from '../../admission/index.js';

class MemoryQuota implements Quota {
  private readonly windows = new Map<string, { count: number; reset: number }>();
  private nextExpiry = Number.POSITIVE_INFINITY;
  private expire(now: number): void {
    if (now < this.nextExpiry) return;
    this.nextExpiry = Number.POSITIVE_INFINITY;
    for (const [id, window] of this.windows) {
      if (window.reset <= now) this.windows.delete(id);
      else this.nextExpiry = Math.min(this.nextExpiry, window.reset);
    }
  }
  readonly take = Effect.fn('admission.local_quota')(function* (
    this: MemoryQuota,
    profileId: string,
    limit: number,
    windowMs: number
  ): Effect.fn.Return<Exclude<AdmissionResult, { _tag: 'Unauthorized' }>> {
    const now = yield* Clock.currentTimeMillis;
    this.expire(now);
    if (!this.windows.has(profileId) && this.windows.size >= 10_000)
      return {
        _tag: 'Limited',
        retryAfter: Math.ceil((this.nextExpiry - now) / 1000),
        reset: this.nextExpiry,
      };
    const window = this.windows.get(profileId) ?? { count: 0, reset: now + windowMs };
    if (window.count >= limit)
      return {
        _tag: 'Limited',
        retryAfter: Math.ceil((window.reset - now) / 1000),
        reset: window.reset,
      };
    window.count++;
    this.windows.set(profileId, window);
    this.nextExpiry = Math.min(this.nextExpiry, window.reset);
    return { _tag: 'Allowed', remaining: limit - window.count, reset: window.reset };
  });
}
export const memoryQuotaLayer = Layer.sync(Quota, () => new MemoryQuota());

const consume = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
if count >= tonumber(ARGV[1]) then return {-1, redis.call('PTTL', KEYS[1])} end
count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
return {count, redis.call('PTTL', KEYS[1])}
`;
const decodeResponse = Schema.decodeUnknownEffect(
  Schema.Tuple([Schema.Int, Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))]),
  { reportInput: false }
);

export interface RedisQuotaConfig {
  readonly redisEnabled: boolean;
  readonly redisHost: string;
  readonly redisPort: number;
  readonly redisPassword?: string;
}

class RedisQuota implements Quota {
  private readonly fallback = new MemoryQuota();
  private reconnecting = false;
  constructor(
    private readonly client: Redis,
    private readonly permits: Semaphore.Semaphore
  ) {
    client.on('ready', () => {
      this.reconnecting = false;
    });
  }

  private readonly local = Effect.fnUntraced(function* (
    this: RedisQuota,
    profileId: string,
    limit: number,
    windowMs: number,
    reason: 'unavailable' | 'saturated' | 'command_failure'
  ) {
    yield* Effect.try(() => recordCounter('ingestion.quota.local_fallback', 1, { reason })).pipe(
      Effect.ignore
    );
    return yield* this.fallback.take(profileId, limit, windowMs);
  });

  readonly take = Effect.fn('admission.distributed_quota')(function* (
    this: RedisQuota,
    profileId: string,
    limit: number,
    windowMs: number
  ): Effect.fn.Return<Exclude<AdmissionResult, { _tag: 'Unauthorized' }>> {
    if (this.reconnecting || this.client.status !== 'ready')
      return yield* this.local(profileId, limit, windowMs, 'unavailable');
    const reply = yield* this.permits.withPermitsIfAvailable(1)(
      Effect.tryPromise({
        try: () =>
          this.client.eval(consume, 1, `wallpaperdb:ratelimit:user:${profileId}`, limit, windowMs),
        catch: (cause) => cause,
      }).pipe(
        Effect.flatMap(decodeResponse),
        Effect.tapError((cause) =>
          Effect.logWarning('Distributed upload quota failed; enforcing local quota', {
            operation: 'consume-upload-quota',
            cause,
          })
        ),
        Effect.catch(() =>
          Effect.sync(() => {
            if (!this.reconnecting) {
              this.reconnecting = true;
              this.client.disconnect(true);
            }
            return undefined;
          })
        ),
        // Redis cannot cancel issued commands. Retain the permit until the
        // command deadline, including when the requesting fiber is interrupted.
        Effect.uninterruptible
      )
    );
    if (reply._tag === 'None') return yield* this.local(profileId, limit, windowMs, 'saturated');
    if (reply.value === undefined)
      return yield* this.local(profileId, limit, windowMs, 'command_failure');
    const [count, ttl] = reply.value;
    const now = yield* Clock.currentTimeMillis;
    if (count === -1)
      return { _tag: 'Limited', reset: now + ttl, retryAfter: Math.ceil(ttl / 1000) };
    return { _tag: 'Allowed', remaining: Math.max(0, limit - count), reset: now + ttl };
  });
}

export function redisQuotaLayer(config: RedisQuotaConfig): Layer.Layer<Quota> {
  if (!config.redisEnabled) return memoryQuotaLayer;
  return Layer.effect(
    Quota,
    Effect.gen(function* () {
      const connectionFailures = yield* Queue.make<unknown>({ capacity: 1, strategy: 'sliding' });
      yield* Stream.fromQueue(connectionFailures).pipe(
        Stream.runForEach((cause) =>
          Effect.logWarning('Distributed upload quota connection failed', {
            operation: 'connect-upload-quota',
            cause,
          })
        ),
        Effect.forkScoped
      );
      const permits = yield* Semaphore.make(64);
      const client = yield* Effect.acquireRelease(
        Effect.sync(
          () =>
            new Redis({
              host: config.redisHost,
              port: config.redisPort,
              password: config.redisPassword,
              lazyConnect: true,
              enableOfflineQueue: false,
              autoResendUnfulfilledCommands: false,
              maxRetriesPerRequest: 0,
              retryStrategy: (attempt) => Math.min(100 * attempt, 2000),
              connectTimeout: 1000,
              commandTimeout: 1000,
              socketTimeout: 1000,
              disconnectTimeout: 100,
            })
        ),
        (client) =>
          Effect.callback<void>((resume) => {
            if (
              client.status === 'end' ||
              client.status === 'reconnecting' ||
              client.status === 'wait'
            ) {
              client.disconnect();
              resume(Effect.void);
              return;
            }
            const closed = () => resume(Effect.void);
            client.once('end', closed);
            client.disconnect();
            return Effect.sync(() => client.removeListener('end', closed));
          })
      );
      client.on('error', (cause) => Queue.offerUnsafe(connectionFailures, cause));
      yield* Effect.tryPromise(() => client.connect()).pipe(
        Effect.catch((cause) =>
          Effect.logWarning(
            'Distributed upload quota unavailable at startup; enforcing local quota',
            {
              operation: 'connect-upload-quota',
              cause,
            }
          )
        )
      );
      return new RedisQuota(client, permits);
    })
  );
}
