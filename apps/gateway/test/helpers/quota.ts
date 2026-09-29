import { DateTime, Effect, Layer, Ref } from 'effect';
import { Quota, type AdmissionResult } from '../../src/capabilities/admission/index.js';

type Windows = Map<string, { tokens: number; updated: number }>;

/** Controlled atomic weighted token bucket; each layer build owns independent state. */
export const memoryQuotaLayer: Layer.Layer<Quota> = Layer.effect(
  Quota,
  Effect.gen(function* () {
    const windows = yield* Ref.make(new Map<string, { tokens: number; updated: number }>());
    const take = Effect.fn('test.quota.take')(function* (
      visitor: string,
      limit: number,
      windowMs: number,
      cost: number
    ) {
      const now = DateTime.toEpochMillis(yield* DateTime.now);
      return yield* Ref.modify(windows, (current): [AdmissionResult, Windows] => {
        const key = visitor;
        const saved = current.get(key);
        const tokens = saved
          ? Math.min(limit, saved.tokens + (Math.max(0, now - saved.updated) * limit) / windowMs)
          : limit;
        if (tokens < cost)
          return [
            { _tag: 'Limited', retryAfter: Math.ceil(((cost - tokens) * windowMs) / limit) },
            current,
          ];
        const remaining = tokens - cost;
        const updated = new Map(current);
        updated.set(key, { tokens: remaining, updated: now });
        return [
          {
            _tag: 'Allowed',
            remaining: Math.floor(remaining),
            reset: now + Math.ceil(((limit - remaining) * windowMs) / limit),
          },
          updated,
        ];
      });
    });
    return Quota.of({ take });
  })
);
