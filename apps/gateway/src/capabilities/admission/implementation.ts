import { Clock, DateTime, Effect, Layer } from 'effect';
import type { AdmissionPolicy, AdmissionResult, Inspection } from './contract.js';
import { Admission, AdmissionTelemetry, Quota } from './contract.js';

export function admissionLayer(
  policy: AdmissionPolicy
): Layer.Layer<Admission, never, Quota | AdmissionTelemetry> {
  return Layer.effect(
    Admission,
    Effect.gen(function* () {
      const quota = yield* Quota;
      const telemetry = yield* AdmissionTelemetry;
      const local = new Map<string, { tokens: number; updated: number }>();
      let nextSweep = 0;
      let degraded = false;
      const fallback = Effect.fn('admission.local_quota')(function* (
        visitor: string,
        cost: number
      ): Effect.fn.Return<AdmissionResult> {
        const now = yield* Clock.currentTimeMillis;
        const { capacity, refillMs, maxVisitors } = policy.fallback;
        // Reclaim only fully refilled budgets. Never evict depleted visitors to admit a new IP.
        if (now >= nextSweep) {
          for (const [key, state] of local) {
            if (state.tokens + (Math.max(0, now - state.updated) * capacity) / refillMs >= capacity)
              local.delete(key);
          }
          nextSweep = now + Math.min(1000, refillMs);
        }
        const state = local.get(visitor);
        const tokens = state
          ? Math.min(
              capacity,
              state.tokens + (Math.max(0, now - state.updated) * capacity) / refillMs
            )
          : capacity;
        if (tokens < cost)
          return {
            _tag: 'Limited',
            retryAfter: Math.ceil(((cost - tokens) * refillMs) / capacity),
            limit: capacity,
          };
        if (cost > 0 && !state && local.size >= maxVisitors) {
          yield* telemetry.record({ _tag: 'LocalStateSaturated' });
          return { _tag: 'Saturated' };
        }
        const remaining = tokens - cost;
        if (cost > 0) local.set(visitor, { tokens: remaining, updated: now });
        return {
          _tag: 'Allowed',
          remaining: Math.floor(remaining),
          reset: now + Math.ceil(((capacity - remaining) * refillMs) / capacity),
          limit: capacity,
        };
      });
      const admit = Effect.fn('admission.admit')(function* (
        visitor: string,
        inspection: Inspection
      ): Effect.fn.Return<AdmissionResult> {
        if (policy.enabled) {
          const cost = inspection._tag === 'Rejected' ? 100 : inspection.cost;
          return yield* quota.take(visitor, policy.limit, policy.windowMs, cost).pipe(
            Effect.tap((result) => {
              if (result._tag === 'Saturated' || !degraded) return Effect.void;
              degraded = false;
              return telemetry.record({ _tag: 'Recovery' });
            }),
            Effect.catchTag('QuotaUnavailable', (error) =>
              Effect.gen(function* () {
                degraded = true;
                yield* telemetry.record({ _tag: 'Fallback', reason: error.reason });
                return yield* fallback(visitor, cost);
              })
            )
          );
        }
        yield* telemetry.record({ _tag: 'Disabled' });
        const now = yield* DateTime.now;
        return {
          _tag: 'Allowed',
          remaining: policy.limit,
          reset: DateTime.toEpochMillis(now) + policy.windowMs,
        };
      });
      return Admission.of({ admit });
    })
  );
}
