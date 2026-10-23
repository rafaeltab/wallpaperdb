import { Context, Data, type Effect } from 'effect';
import type { ProfilePrincipal } from '../profile/index.js';
export interface AttachmentTrace {
  readonly traceparent?: string;
  readonly tracestate?: string;
}
export interface SourceIntent {
  readonly candidateId: string;
  readonly intentId: string;
}
export interface PictureAttachment {
  readonly id: string;
  readonly profileId: string;
  readonly key: string;
  readonly expectedVersion: number;
  readonly commandId: string;
  readonly creationEventId: string;
  readonly createdAt: string;
  readonly trace?: AttachmentTrace;
  readonly deleteCommandId: string;
  readonly deletionEventId: string;
  state:
    | 'creating-asset'
    | 'awaiting-source'
    | 'accepting-source'
    | 'attached'
    | 'cancelled'
    | 'conflicted'
    | 'abandoned'
    | 'failed';
  assetId: string | null;
  sourceIntent: SourceIntent | null;
  sourceId: string | null;
  deletion: 'none' | 'pending' | 'complete';
  attentionRequired?: boolean;
}
export interface AttachmentProfile {
  readonly id: string;
  readonly version: number;
  readonly pictureAssetId: string | null;
  readonly pictureIntentId: string | null;
}
export class AttachmentFailure extends Data.TaggedError('AttachmentFailure')<{
  readonly operation: string;
  readonly cause: unknown;
}> {}
export type AttachmentOutcome =
  | { readonly kind: 'attachment'; readonly attachment: PictureAttachment }
  | { readonly kind: 'conflict' | 'unavailable' | 'forbidden' };
export interface AttachmentResult {
  readonly attachmentId: string;
  readonly commandId: string;
  readonly causationId: string;
  readonly outcome: 'created' | 'deleted' | 'already-deleted' | 'rejected';
  readonly assetId: string | null;
}
export interface SourceConfirmation extends SourceIntent {
  readonly trace?: AttachmentTrace;
  readonly assetId: string;
  readonly sourceId: string;
  readonly defaultSourceId: string;
  readonly initialAnalysisSourceId: string;
  readonly occurrenceId: string;
}
export interface PictureAttachments {
  readonly begin: (
    principal: ProfilePrincipal,
    key: string,
    expectedVersion: number,
    trace?: AttachmentTrace
  ) => Effect.Effect<AttachmentOutcome, AttachmentFailure>;
  readonly get: (
    principal: ProfilePrincipal,
    id: string
  ) => Effect.Effect<AttachmentOutcome, AttachmentFailure>;
  readonly expectSource: (
    principal: ProfilePrincipal,
    id: string,
    source: SourceIntent
  ) => Effect.Effect<AttachmentOutcome, AttachmentFailure>;
  readonly cancel: (
    principal: ProfilePrincipal,
    id: string
  ) => Effect.Effect<AttachmentOutcome, AttachmentFailure>;
  readonly assetResult: (
    result: AttachmentResult
  ) => Effect.Effect<'applied' | 'ignored' | 'requires-attention', AttachmentFailure>;
  readonly sourceAccepted: (
    confirmation: SourceConfirmation
  ) => Effect.Effect<'applied' | 'ignored', AttachmentFailure>;
}
export const PictureAttachments = Context.Service<PictureAttachments>(
  'user/picture-attachments/Capability'
);
export type AttachmentSelector =
  | {
      readonly kind: 'begin';
      readonly profileId: string;
      readonly key: string;
      readonly expectedVersion: number;
      readonly trace?: AttachmentTrace;
    }
  | {
      readonly kind: 'intent' | 'asset';
      readonly id: string;
      readonly sourceIntent?: SourceIntent;
    };
export interface AttachmentSnapshot {
  readonly intent: PictureAttachment | null;
  readonly previous: PictureAttachment | null;
  readonly profile: AttachmentProfile | null;
  readonly existing: boolean;
  readonly registered: boolean;
}
export interface AttachmentTransition<A> {
  readonly result: A;
  readonly intent?: PictureAttachment;
  readonly previous?: PictureAttachment;
  readonly select?: boolean;
  readonly registration?: SourceIntent;
  readonly attach?: {
    readonly assetId: string;
    readonly sourceId: string;
    readonly causationId: string;
    readonly trace?: AttachmentTrace;
  };
}
/** Locks the owning Profile before its intents across all selectors. Begin supplies a fresh,
 * detached intent unless the owner/key/expected-version was already reserved.
 * Reusing a key at a later Profile version reserves a new identity. The callback is pure.
 * Intent changes, current-intent selection, Profile attachment/version and its event,
 * and stable create/orphan-delete outbox obligations commit in one transaction.
 * Attachment is permitted only for the selected intent at its expected Profile version
 * with no current picture. Intent, Asset and command identities are never reused.
 * No external resource participates in this transaction. */
export interface AttachmentStore {
  readonly change: <A>(
    selector: AttachmentSelector,
    decide: (snapshot: AttachmentSnapshot) => AttachmentTransition<A>
  ) => Effect.Effect<A, AttachmentFailure>;
}
export const AttachmentStore = Context.Service<AttachmentStore>('user/picture-attachments/Store');
export interface AttachmentPublication {
  readonly id: string;
  readonly attachmentId: string;
  readonly destination: string;
  readonly event: Readonly<Record<string, unknown>>;
  readonly leaseId: string;
  readonly attempts: number;
}
/** PubAck completes publication. Leases and finite attempts survive restart; exhausted
 * work is quarantined. Only trusted operator composition may reset quarantined work. */
export interface AttachmentDelivery {
  readonly claim: () => Effect.Effect<readonly AttachmentPublication[], AttachmentFailure>;
  /** Matching-lease completion and remaining attention commit together; stale leases do nothing. */
  readonly complete: (p: AttachmentPublication) => Effect.Effect<void, AttachmentFailure>;
  readonly failed: (p: AttachmentPublication) => Effect.Effect<void, AttachmentFailure>;
  readonly quarantine: (
    id: string,
    payload: string,
    reason: string,
    target?: { readonly kind: 'intent' | 'asset'; readonly id: string }
  ) => Effect.Effect<void, AttachmentFailure>;
  readonly recover: (id: string) => Effect.Effect<boolean, AttachmentFailure>;
  readonly alerts: () => Effect.Effect<
    readonly {
      readonly id: string;
      readonly scope: 'outbox' | 'confirmation';
      readonly reason: 'invalid' | 'exhausted';
    }[],
    AttachmentFailure
  >;
  readonly alerted: (
    id: string,
    scope: 'outbox' | 'confirmation'
  ) => Effect.Effect<void, AttachmentFailure>;
  readonly retainedConfirmation: (id: string) => Effect.Effect<string | null, AttachmentFailure>;
  /** Closes a recovered confirmation and reconciles its intent's remaining attention
   * in one local transaction. Repeated quarantine cannot reopen a recovered record. */
  readonly confirmationRecovered: (id: string) => Effect.Effect<void, AttachmentFailure>;
}
export const AttachmentDelivery = Context.Service<AttachmentDelivery>(
  'user/picture-attachments/Delivery'
);
export interface AttachmentHealth {
  readonly check: () => Effect.Effect<boolean>;
}
export const AttachmentHealth = Context.Service<AttachmentHealth>(
  'user/picture-attachments/Health'
);
