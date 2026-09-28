import { DateTime, Effect, Layer } from 'effect';
import type { AdmissionPolicy, AdmissionResult } from './contract.js';
import { Admission, Quota } from './contract.js';

export function admissionLayer(policy: AdmissionPolicy): Layer.Layer<Admission, never, Quota> {
  return Layer.effect(
    Admission,
    Effect.gen(function* () {
      const quota = yield* Quota;
      const admit = Effect.fn('admission.admit')(function* (
        visitor: string
      ): Effect.fn.Return<AdmissionResult> {
        if (policy.enabled) return yield* quota.take(visitor, policy.limit, policy.windowMs);
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
