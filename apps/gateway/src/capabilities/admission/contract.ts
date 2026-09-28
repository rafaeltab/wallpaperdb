import { Context, type Effect } from 'effect';

export interface AdmissionPolicy {
  readonly enabled: boolean;
  readonly limit: number;
  readonly windowMs: number;
}

export type AdmissionResult =
  | { readonly _tag: 'Allowed'; readonly remaining: number; readonly reset: number }
  | { readonly _tag: 'Limited'; readonly retryAfter: number };

/** Atomic fixed-window consumption: a denied request never extends the window.
 * Visitor keys and windows are isolated; unavailable distributed storage admits
 * requests without charging quota and resumes normal limits after recovery.
 */
export interface Quota {
  take(visitor: string, limit: number, windowMs: number): Effect.Effect<AdmissionResult>;
}

export const Quota = Context.Service<Quota>('wallpaperdb.gateway.admission.Quota');

export interface Admission {
  admit(visitor: string): Effect.Effect<AdmissionResult>;
}

export const Admission = Context.Service<Admission>('wallpaperdb.gateway.admission.Admission');
