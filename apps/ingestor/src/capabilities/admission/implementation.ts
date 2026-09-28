import { Effect, Layer } from 'effect';

import { Admission, Quota } from './contract.js';

export function admissionLayer(policy: { readonly limit: number; readonly windowMs: number }) {
  return Layer.effect(
    Admission,
    Effect.gen(function* () {
      const quota = yield* Quota;
      return Admission.of({
        admit: Effect.fn('admission.admit')(function* (principal) {
          if (!principal.profileId.trim()) return { _tag: 'Unauthorized' } as const;
          return yield* quota.take(principal.profileId, policy.limit, policy.windowMs);
        }),
      });
    })
  );
}
