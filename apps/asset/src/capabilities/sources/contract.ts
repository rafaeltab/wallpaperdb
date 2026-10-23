import { Context, Data, type Effect } from 'effect';
import type { OwnedAsset, Owner, CommandContext } from '../lifecycle/index.js';
import type { SourcePolicy } from './policy.js';
export class SourceFailure extends Data.TaggedError('SourceFailure')<{
  readonly operation: string;
  readonly cause: unknown;
}> {}
export interface SourceFacts {
  readonly model: string;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  readonly byteLength: number;
  readonly digest: string;
  readonly animation?: {
    readonly frames: number;
    readonly loop: number;
    readonly delaysMs: readonly number[];
  };
  readonly hasAlpha?: boolean;
  readonly orientation?: number;
}
export type SourceOperation = 'add' | 'replace-one' | 'replace-set';
export interface CandidateIntent {
  readonly operation: SourceOperation;
  readonly expectedSourceSetRevision: string;
  readonly targetSourceId?: string;
  readonly context?: CommandContext;
}
export interface Candidate extends CandidateIntent {
  readonly candidateId: string;
  readonly sourceId: string;
  readonly idempotencyKey: string;
  status:
    | 'awaiting-bytes'
    | 'inspecting'
    | 'ready'
    | 'accepting'
    | 'accepted'
    | 'rejected'
    | 'cancelled';
  readonly expiresAt: string;
  readonly orphanExpiresAt: string;
  readonly layout: 'asset-layout-1';
  digest?: string;
  facts?: SourceFacts;
  reason?: string;
  sourceSetRevision?: string;
}
export interface AcceptedSource {
  readonly sourceId: string;
  readonly facts: SourceFacts;
  readonly layout: 'asset-layout-1';
}
export interface SourceState {
  readonly asset: OwnedAsset;
  sourceSetRevision: string;
  deliveryRevision: string;
  defaultSourceId: string | null;
  initialAnalysisSourceId: string | null;
  sources: AcceptedSource[];
  candidates: Candidate[];
  /** Includes expired records until their durable status becomes terminal. */
  nonterminalCandidateCount: number;
}
export interface SourceConfirmation {
  readonly context: CommandContext;
  readonly id: string;
  readonly applicationId: string;
  readonly assetId: string;
  readonly assetType: string;
  readonly candidateId: string;
  readonly sourceId: string;
  readonly defaultSourceId: string;
  readonly sourceSetRevision: string;
  readonly deliveryRevision: string;
  readonly initialAnalysisSourceId: string;
}
export type SourceOutcome =
  | { readonly kind: 'candidate'; readonly candidate: Candidate }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'rejected'; readonly reason: string };
export type SourceChangeOutcome =
  | {
      readonly kind: 'changed';
      readonly sourceSetRevision: string;
      readonly deliveryRevision: string;
      readonly defaultSourceId: string;
    }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'rejected'; readonly reason: string };
/** Serializes one Asset. The callback is pure, receives a detached state, and cannot
 * escape transaction resources. State, immutable Source metadata, cleanup deadlines,
 * initial analysis provenance and confirmation outbox commit together. Retirement records
 * evidence expiry once on the immutable Source row, without hydrating retirement history.
 * Active membership gates all Source and descendant eligibility; retained bytes confer none. A non-null
 * revision locks/compares the active configuration in that same transaction. */
export interface SourceStorePort {
  readonly transact: <A>(
    assetId: string,
    revision: string | null,
    change: (state: SourceState | null) => {
      readonly state: SourceState | null;
      readonly result: A;
      readonly confirmation?: SourceConfirmation;
      readonly retirement?: {
        readonly sourceId: string;
        readonly evidenceExpiresAt: string;
      };
      readonly readProtection?: {
        readonly readId: string;
        readonly sourceId: string;
        readonly expiresAt: string;
      };
    }
  ) => Effect.Effect<A, SourceFailure>;
  readonly releaseRead: (readId: string) => Effect.Effect<void, SourceFailure>;
}
export class SourceStore extends Context.Service<SourceStore, SourceStorePort>()(
  'asset/sources/Store'
) {}
/** Conditional immutable objects, verified by digest on replay including an ambiguous
 * successful write. Prepare copies to the reserved immutable Source identity before
 * membership. Read closes its underlying stream on interruption or explicit close. */
export interface SourceBytesPort {
  readonly put: (
    candidateId: string,
    bytes: Uint8Array,
    digest: string
  ) => Effect.Effect<void, SourceFailure>;
  readonly prepare: (
    candidateId: string,
    sourceId: string,
    assetId: string,
    facts: SourceFacts
  ) => Effect.Effect<void, SourceFailure>;
  readonly read: (
    sourceId: string,
    assetId: string,
    lifetimeMs?: number
  ) => Effect.Effect<
    {
      readonly bytes: AsyncIterable<Uint8Array>;
      readonly close: () => Effect.Effect<void>;
      readonly closed: Effect.Effect<void>;
    },
    SourceFailure
  >;
}
export class SourceBytes extends Context.Service<SourceBytes, SourceBytesPort>()(
  'asset/sources/Bytes'
) {}
export interface MandatoryInspectionPort {
  readonly inspect: (
    candidateId: string,
    policy: SourcePolicy
  ) => Effect.Effect<
    | { readonly kind: 'verified'; readonly facts: SourceFacts }
    | { readonly kind: 'rejected'; readonly reason: string },
    SourceFailure
  >;
}
export class MandatoryInspection extends Context.Service<
  MandatoryInspection,
  MandatoryInspectionPort
>()('asset/sources/MandatoryInspection') {}
/** A driving stream owns cancellation of a blocked next() and its transport resources. */
export interface SourceUpload extends AsyncIterable<Uint8Array> {
  readonly cancel: () => void;
}
export interface SourcesPort {
  readonly selectDefault: (
    owner: Owner,
    assetId: string,
    sourceId: string,
    expectedSourceSetRevision: string
  ) => Effect.Effect<SourceChangeOutcome, SourceFailure>;
  readonly withdraw: (
    owner: Owner,
    assetId: string,
    sourceId: string,
    expectedSourceSetRevision: string
  ) => Effect.Effect<SourceChangeOutcome, SourceFailure>;
  readonly policy: (
    owner: Owner,
    type: string
  ) => Effect.Effect<
    | { readonly kind: 'policy'; readonly policy: SourcePolicy; readonly revision: string }
    | { readonly kind: 'unavailable' }
  >;
  readonly list: (
    owner: Owner,
    assetId: string,
    candidateCursor?: string
  ) => Effect.Effect<
    | {
        readonly kind: 'found';
        readonly asset: {
          readonly assetId: string;
          readonly assetType: string;
          readonly sources: readonly AcceptedSource[];
          readonly candidates: readonly Candidate[];
          readonly hasPendingCandidates: boolean;
          readonly nextCandidateCursor?: string;
          readonly defaultSourceId: string | null;
          readonly sourceSetRevision: string;
          readonly deliveryRevision: string;
        };
      }
    | { readonly kind: 'unavailable' },
    SourceFailure
  >;
  readonly create: (
    owner: Owner,
    assetId: string,
    input: CandidateIntent & { readonly idempotencyKey: string }
  ) => Effect.Effect<SourceOutcome, SourceFailure>;
  readonly status: (
    owner: Owner,
    assetId: string,
    candidateId: string
  ) => Effect.Effect<SourceOutcome, SourceFailure>;
  readonly cancel: (
    owner: Owner,
    assetId: string,
    candidateId: string
  ) => Effect.Effect<SourceOutcome, SourceFailure>;
  readonly upload: (
    owner: Owner,
    assetId: string,
    candidateId: string,
    bytes: SourceUpload
  ) => Effect.Effect<SourceOutcome, SourceFailure>;
  readonly accept: (
    owner: Owner,
    assetId: string,
    candidateId: string,
    intent: CandidateIntent
  ) => Effect.Effect<SourceOutcome, SourceFailure>;
  readonly original: (
    owner: Owner,
    assetId: string,
    sourceId: string
  ) => Effect.Effect<
    | {
        readonly kind: 'original';
        readonly facts: SourceFacts;
        readonly bytes: AsyncIterable<Uint8Array>;
        readonly close: () => Effect.Effect<void>;
      }
    | { readonly kind: 'unavailable' },
    SourceFailure
  >;
}
export class Sources extends Context.Service<Sources, SourcesPort>()('asset/sources/Sources') {}
export interface SourcePublication {
  readonly confirmation: SourceConfirmation;
  readonly id: string;
  readonly leaseId: string;
  readonly occurredAt: string;
  readonly attempts: number;
}
export interface SourceAcceptanceOutboxPort {
  readonly claim: (limit: number) => Effect.Effect<readonly SourcePublication[], SourceFailure>;
  readonly published: (publication: SourcePublication) => Effect.Effect<void, SourceFailure>;
  readonly failed: (publication: SourcePublication) => Effect.Effect<void, SourceFailure>;
  readonly pendingAlerts: () => Effect.Effect<readonly SourceConfirmation[], SourceFailure>;
  readonly alerted: (id: string) => Effect.Effect<void, SourceFailure>;
  readonly recover: (id: string) => Effect.Effect<boolean, SourceFailure>;
}
export class SourceAcceptanceOutbox extends Context.Service<
  SourceAcceptanceOutbox,
  SourceAcceptanceOutboxPort
>()('asset/sources/AcceptanceOutbox') {}
