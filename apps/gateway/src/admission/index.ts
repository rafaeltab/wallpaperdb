import { Clock, Effect } from 'effect';

export interface AdmissionPolicy {
  readonly enabled: boolean;
  readonly limit: number;
  readonly windowMs: number;
}
export type AdmissionResult =
  | { readonly _tag: 'Allowed'; readonly remaining: number; readonly reset: number }
  | { readonly _tag: 'Limited'; readonly retryAfter: number };

/** Atomic fixed-window consumption: a denied request never extends the window.
 * Visitor keys and windows are isolated; unavailable distributed storage falls
 * back to an instance-local window with the same consumption semantics.
 */
export interface Quota {
  take(visitor: string, limit: number, windowMs: number): Effect.Effect<AdmissionResult>;
}
export const Quota = Symbol.for('wallpaperdb.gateway.admission.Quota');
export interface Admission {
  admit(visitor: string): Effect.Effect<AdmissionResult>;
}
export const Admission = Symbol.for('wallpaperdb.gateway.admission.Admission');

class RequestAdmission implements Admission {
  constructor(
    private readonly quota: Quota,
    private readonly policy: AdmissionPolicy
  ) {}
  admit(visitor: string): Effect.Effect<AdmissionResult> {
    const decision = this.policy.enabled
      ? this.quota.take(visitor, this.policy.limit, this.policy.windowMs)
      : Clock.currentTimeMillis.pipe(
          Effect.map(
            (now): AdmissionResult => ({
              _tag: 'Allowed',
              remaining: this.policy.limit,
              reset: now + this.policy.windowMs,
            })
          )
        );
    return decision.pipe(Effect.withSpan('admission.admit'));
  }
}
export function createAdmission(quota: Quota, policy: AdmissionPolicy): Admission {
  return new RequestAdmission(quota, policy);
}
