import { DateTime, Effect, Layer, Ref } from 'effect';
import { Quota, type AdmissionResult } from '../../src/admission/index.js';

type Windows = Map<string, { count: number; reset: number }>;

/** Controlled atomic fixed-window adapter; each layer build owns independent state. */
export const memoryQuotaLayer: Layer.Layer<Quota> = Layer.effect(
  Quota,
  Effect.gen(function* () {
    const windows = yield* Ref.make(new Map<string, { count: number; reset: number }>());
    const take = Effect.fn('test.quota.take')(function* (
      visitor: string,
      limit: number,
      windowMs: number
    ) {
      const now = DateTime.toEpochMillis(yield* DateTime.now);
      return yield* Ref.modify(windows, (current): [AdmissionResult, Windows] => {
        const key = JSON.stringify([visitor, windowMs]);
        const saved = current.get(key);
        const window = saved && saved.reset > now ? saved : { count: 0, reset: now + windowMs };
        if (window.count >= limit)
          return [{ _tag: 'Limited', retryAfter: window.reset - now }, current];
        const updated = new Map(current);
        updated.set(key, { ...window, count: window.count + 1 });
        return [
          { _tag: 'Allowed', remaining: limit - window.count - 1, reset: window.reset },
          updated,
        ];
      });
    });
    return Quota.of({ take });
  })
);
