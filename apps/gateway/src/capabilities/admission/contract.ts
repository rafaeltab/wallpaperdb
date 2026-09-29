import { Context, Schema, type Effect } from 'effect';

export interface AdmissionPolicy {
  readonly enabled: boolean;
  readonly limit: number;
  readonly windowMs: number;
  readonly fallback: {
    readonly capacity: number;
    readonly refillMs: number;
    readonly maxVisitors: number;
  };
}

export class QuotaUnavailable extends Schema.TaggedError<QuotaUnavailable>()('QuotaUnavailable', {
  reason: Schema.Literals(['disabled', 'unavailable', 'command_failure']),
}) {}

export type AdmissionResult =
  | { readonly _tag: 'Saturated' }
  | {
      readonly _tag: 'Allowed';
      readonly remaining: number;
      readonly reset: number;
      readonly limit?: number;
    }
  | { readonly _tag: 'Limited'; readonly retryAfter: number; readonly limit?: number };

/** Atomic weighted token bucket: capacity refills continuously over windowMs.
 * Callers provide nonnegative cost no larger than capacity.
 * Cost is reserved once, never refunded; denial does not debit or extend expiry.
 * Visitor keys are isolated. Unavailable storage fails with QuotaUnavailable;
 * occupied command slots return Saturated and do not debit quota.
 */
export interface Quota {
  take(
    visitor: string,
    limit: number,
    windowMs: number,
    cost: number
  ): Effect.Effect<AdmissionResult, QuotaUnavailable>;
}

export const Quota = Context.Service<Quota>('wallpaperdb.gateway.admission.Quota');

export type Inspection =
  | { readonly _tag: 'Valid'; readonly cost: number }
  | { readonly _tag: 'Rejected' };

export interface Admission {
  admit(visitor: string, inspection: Inspection): Effect.Effect<AdmissionResult>;
}

export const Admission = Context.Service<Admission>('wallpaperdb.gateway.admission.Admission');
