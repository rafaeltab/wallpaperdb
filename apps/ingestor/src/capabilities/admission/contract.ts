import { Context, type Effect } from 'effect';

export type AdmissionResult =
  | { readonly _tag: 'Allowed'; readonly remaining: number; readonly reset: number }
  | { readonly _tag: 'Limited'; readonly retryAfter: number; readonly reset: number }
  | { readonly _tag: 'Unauthorized' };

/** Atomic per-Profile fixed windows. Denial never extends a window. Adapter
 * instances isolate local fallback state; distributed failures retain local limits. */
export interface Quota {
  take(
    profileId: string,
    limit: number,
    windowMs: number
  ): Effect.Effect<Exclude<AdmissionResult, { _tag: 'Unauthorized' }>>;
}

export const Quota = Context.Service<Quota>('wallpaperdb.ingestor.admission.Quota');

export interface Admission {
  admit(principal: { readonly profileId: string }): Effect.Effect<AdmissionResult>;
}

export const Admission = Context.Service<Admission>('wallpaperdb.ingestor.admission.Admission');
