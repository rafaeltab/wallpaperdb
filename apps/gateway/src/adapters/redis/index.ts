import { recordCounter } from '@wallpaperdb/core/telemetry';
import { Clock, Effect, Layer, Queue, Schema, Semaphore, Stream } from 'effect';
import Redis from 'ioredis';
import {
  type AdmissionResult,
  Quota,
  QuotaUnavailable,
} from '../../capabilities/admission/index.js';

const consume = `
local capacity = tonumber(ARGV[1])
local period = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local state = redis.call('HMGET', KEYS[1], 'tokens', 'updated')
local tokens = capacity
if redis.call('EXISTS', KEYS[1]) == 1 then
  if not tonumber(state[1]) or not tonumber(state[2]) or redis.call('PTTL', KEYS[1]) < 0 then
    return redis.error_reply('Invalid quota state')
  end
  tokens = math.min(capacity, tonumber(state[1]) + math.max(0, now - tonumber(state[2])) * capacity / period)
end
if tokens < cost then
  return {0, math.floor(tokens), math.ceil((cost - tokens) * period / capacity)}
end
tokens = tokens - cost
local refill = math.ceil((capacity - tokens) * period / capacity)
if cost > 0 then
  redis.call('HSET', KEYS[1], 'tokens', tokens, 'updated', now)
  redis.call('PEXPIRE', KEYS[1], math.max(1, refill))
end
return {1, math.floor(tokens), refill}
`;
const decodeResponse = Schema.decodeUnknownEffect(
  Schema.Tuple([
    Schema.Literals([0, 1]),
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  ]),
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
    windowMs: number,
    cost: number
  ): Effect.fn.Return<AdmissionResult, QuotaUnavailable> {
    const reply = yield* this.permits.withPermitsIfAvailable(1)(
      Effect.suspend(() => {
        if (!this.client) return unavailable('disabled');
        if (!this.available) return unavailable('unavailable');
        const client = this.client;
        return Effect.tryPromise({
          try: () => client.eval(consume, 1, `graphql:quota:${visitor}`, limit, windowMs, cost),
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
          Effect.catch((cause) =>
            Effect.logWarning('Distributed quota command failed', { cause }).pipe(
              Effect.andThen(
                Effect.sync(() => {
                  this.disconnect();
                  return undefined;
                })
              )
            )
          ),
          // Redis cannot cancel an issued command. Keep its permit until the command
          // settles under the client's one-second deadline, including on caller cancellation.
          Effect.uninterruptible
        );
      })
    );
    if (reply._tag === 'None') {
      yield* Effect.try(() =>
        recordCounter('admission.quota.saturated', 1, { reason: 'saturated' })
      ).pipe(Effect.ignore);
      return { _tag: 'Saturated' };
    }
    if (reply.value === undefined) return yield* unavailable('command_failure');
    const [allowed, remaining, refill] = reply.value;
    if (allowed === 0) return { _tag: 'Limited', retryAfter: refill };
    const now = yield* Clock.currentTimeMillis;
    return { _tag: 'Allowed', remaining, reset: now + refill };
  });
}
const unavailable = Effect.fnUntraced(function* (
  reason: QuotaUnavailable['reason']
): Effect.fn.Return<never, QuotaUnavailable> {
  yield* Effect.try(() => recordCounter('admission.quota.unavailable', 1, { reason })).pipe(
    Effect.ignore
  );
  return yield* Effect.fail(new QuotaUnavailable({ reason }));
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
            : Effect.logWarning('Distributed quota unavailable; local admission required')
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
          Effect.logWarning('Distributed quota unavailable at startup; local admission required')
        )
      );
      return quota;
    })
  );
}
