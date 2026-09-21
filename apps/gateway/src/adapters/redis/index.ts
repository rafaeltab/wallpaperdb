import { recordCounter } from '@wallpaperdb/core/telemetry';
import { Clock, Effect, Layer, Queue, Schema, Semaphore, Stream } from 'effect';
import Redis from 'ioredis';
import { type AdmissionResult, Quota } from '../../admission/index.js';

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
  private available = false;
  constructor(
    private readonly client: Redis | undefined,
    private readonly permits: Semaphore.Semaphore,
    private readonly health: Queue.Queue<boolean>
  ) {}
  readonly setAvailable = (available: boolean): void => {
    if (this.available === available) return;
    this.available = available;
    Queue.offerUnsafe(this.health, available);
  };
  private readonly disconnect = (): void => {
    if (!this.available) return;
    this.setAvailable(false);
    this.client?.disconnect(true);
  };
  readonly take = Effect.fn('admission.consume_quota')(function* (
    this: RedisQuota,
    visitor: string,
    limit: number,
    windowMs: number
  ): Effect.fn.Return<AdmissionResult> {
    if (!this.client) return yield* allowWithoutQuota(limit, windowMs, 'disabled');
    if (!this.available) return yield* allowWithoutQuota(limit, windowMs, 'unavailable');
    const client = this.client;
    const reply = yield* this.permits.withPermitsIfAvailable(1)(
      Effect.tryPromise({
        try: (signal) => {
          signal.addEventListener('abort', this.disconnect, { once: true });
          return client
            .eval(consume, 1, `graphql:ratelimit:${visitor}`, limit, windowMs)
            .finally(() => signal.removeEventListener('abort', this.disconnect));
        },
        catch: (cause) => cause,
      }).pipe(
        Effect.flatMap((response) =>
          decodeResponse(response).pipe(
            Effect.tapError((error) =>
              Effect.logWarning('Invalid distributed quota response', {
                operation: 'decode_quota_response',
                detail: error.message,
              })
            )
          )
        ),
        Effect.catch(() =>
          Effect.sync(() => {
            this.disconnect();
            return undefined;
          })
        )
      )
    );
    if (reply._tag === 'None') return yield* allowWithoutQuota(limit, windowMs, 'saturated');
    if (reply.value === undefined)
      return yield* allowWithoutQuota(limit, windowMs, 'command_failure');
    const [count, ttl] = reply.value;
    if (count === -1) return { _tag: 'Limited', retryAfter: ttl };
    const now = yield* Clock.currentTimeMillis;
    return { _tag: 'Allowed', remaining: Math.max(0, limit - count), reset: now + ttl };
  });
}
const allowWithoutQuota = Effect.fnUntraced(function* (
  limit: number,
  windowMs: number,
  reason: 'disabled' | 'unavailable' | 'saturated' | 'command_failure'
): Effect.fn.Return<AdmissionResult> {
  yield* Effect.try(() => recordCounter('admission.quota.unenforced', 1, { reason })).pipe(
    Effect.ignore
  );
  const now = yield* Clock.currentTimeMillis;
  return { _tag: 'Allowed', remaining: limit, reset: now + windowMs };
});
export function redisQuotaLayer(config: RedisQuotaConfig): Layer.Layer<Quota> {
  return Layer.effect(
    Quota,
    Effect.gen(function* () {
      const health = yield* Queue.make<boolean>({ capacity: 1, strategy: 'sliding' });
      yield* Stream.fromQueue(health).pipe(
        Stream.runForEach((available) =>
          (available
            ? Effect.logInfo('Distributed quota enforcement restored')
            : Effect.logWarning('Distributed quota unavailable; allowing requests')
          ).pipe(Effect.annotateLogs({ 'admission.quota.available': available }))
        ),
        Effect.forkScoped
      );
      const permits = yield* Semaphore.make(64);
      if (!config.redisEnabled) {
        yield* Effect.logInfo('Distributed quota enforcement disabled');
        return new RedisQuota(undefined, permits, health);
      }
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
      const quota = new RedisQuota(client, permits, health);
      client.on('ready', () => quota.setAvailable(true));
      client.on('error', () => quota.setAvailable(false));
      client.on('close', () => quota.setAvailable(false));
      yield* Effect.tryPromise(() => client.connect()).pipe(
        Effect.catch(() =>
          Effect.logWarning('Distributed quota unavailable at startup; allowing requests')
        )
      );
      return quota;
    })
  );
}
