import { Context, Data, type Effect } from 'effect';
export interface WorkflowTrace {
  readonly traceparent?: string;
  readonly tracestate?: string;
}
export interface Creator {
  readonly namespace: string;
  readonly subject: string;
}
export class CreatorAuthentication extends Context.Service<
  CreatorAuthentication,
  {
    readonly verify: (
      authorization: string | undefined
    ) => Effect.Effect<Creator | null, WorkflowFailure>;
  }
>()('wallpaper/creation/Authentication') {}
export interface SourceIntent {
  readonly candidateId: string;
  readonly intentId: string;
}
export interface Wallpaper {
  attentionRequired?: boolean;
  readonly id: string;
  readonly owner: Creator;
  readonly key: string;
  readonly commandId: string;
  readonly creationEventId: string;
  readonly createdAt: string;
  state: 'creating-asset' | 'awaiting-source' | 'accepting-source' | 'published' | 'failed';
  assetId: string | null;
  intent: SourceIntent | null;
  sourceId: string | null;
  initialAnalysisSourceId: string | null;
}
export interface Publication {
  readonly id: string;
  readonly wallpaperId: string;
  readonly assetId: string;
  readonly sourceId: string;
  readonly initialAnalysisSourceId: string;
  readonly contributorId: string;
  readonly causationId: string;
  readonly trace?: WorkflowTrace;
}
export class WorkflowFailure extends Data.TaggedError('WorkflowFailure')<{
  readonly operation: string;
  readonly cause: unknown;
}> {}
export type WallpaperOutcome =
  | { readonly kind: 'wallpaper'; readonly wallpaper: Wallpaper }
  | { readonly kind: 'unavailable' | 'conflict' | 'forbidden' };
export interface AssetResult {
  readonly wallpaperId: string;
  readonly commandId: string;
  readonly creationEventId: string;
  readonly outcome: 'created' | 'rejected';
  readonly assetId: string | null;
}
export interface SourceAcceptance extends SourceIntent {
  readonly assetId: string;
  readonly sourceId: string;
  readonly defaultSourceId: string;
  readonly initialAnalysisSourceId: string;
  readonly occurrenceId: string;
  readonly trace?: WorkflowTrace;
}
export interface CreationPort {
  readonly list: (owner: Creator) => Effect.Effect<readonly Wallpaper[], WorkflowFailure>;
  readonly begin: (
    owner: Creator,
    key: string,
    trace?: WorkflowTrace
  ) => Effect.Effect<WallpaperOutcome, WorkflowFailure>;
  readonly get: (owner: Creator, id: string) => Effect.Effect<WallpaperOutcome, WorkflowFailure>;
  readonly expectSource: (
    owner: Creator,
    id: string,
    intent: SourceIntent
  ) => Effect.Effect<WallpaperOutcome, WorkflowFailure>;
  readonly assetResult: (
    result: AssetResult
  ) => Effect.Effect<'applied' | 'ignored', WorkflowFailure>;
  readonly sourceAccepted: (
    confirmation: SourceAcceptance
  ) => Effect.Effect<'applied' | 'ignored', WorkflowFailure>;
}
export class Creation extends Context.Service<Creation, CreationPort>()(
  'wallpaper/creation/Creation'
) {}
/** begin atomically reserves an owner/key, assigns non-reused Wallpaper/command/event
 * identities and records its immutable Asset creation command. Equal replay returns
 * that same intent. change serializes the selected Wallpaper across replicas; the
 * pure callback receives detached values. State and optional publication commit
 * together, including through an ambiguous commit. Asset identity is globally unique. */
export interface WorkflowStorePort {
  readonly list: (owner: Creator) => Effect.Effect<readonly Wallpaper[], WorkflowFailure>;
  readonly begin: (
    owner: Creator,
    key: string,
    trace?: WorkflowTrace
  ) => Effect.Effect<Wallpaper, WorkflowFailure>;
  readonly change: <A>(
    selector: { readonly kind: 'wallpaper' | 'asset'; readonly id: string },
    transition: (wallpaper: Wallpaper | null) => {
      readonly wallpaper: Wallpaper | null;
      readonly result: A;
      readonly publication?: Publication;
    }
  ) => Effect.Effect<A, WorkflowFailure>;
}
export class WorkflowStore extends Context.Service<WorkflowStore, WorkflowStorePort>()(
  'wallpaper/creation/Store'
) {}

export interface WorkflowPublication {
  readonly id: string;
  readonly wallpaperId: string;
  readonly destination: string;
  readonly event: Readonly<Record<string, unknown>>;
  readonly leaseId: string;
  /** Earlier claimed attempts; the current claim has already consumed its durable attempt. */
  readonly attempts: number;
}
export type WorkflowAlert =
  | {
      readonly id: string;
      readonly scope: 'outbox';
      readonly reason: 'exhausted';
      readonly quarantineId: string;
    }
  | {
      readonly id: string;
      readonly scope: 'confirmation';
      readonly reason: 'invalid' | 'exhausted';
    };
/** Leased claims survive restart and consume the finite budget even when abandoned.
 * Publication is complete only after broker PubAck.
 * Exhausted attempts remain quarantined with their original identity, never reset
 * by an HTTP retry. Deliberate recovery renews the durable quarantine identity;
 * notification retries retain it. Acknowledgement only closes the matching active
 * quarantine. Recovery is available only to trusted operator composition. */
export interface WorkflowDeliveryPort {
  readonly alerts: () => Effect.Effect<readonly WorkflowAlert[], WorkflowFailure>;
  readonly alerted: (alert: WorkflowAlert) => Effect.Effect<void, WorkflowFailure>;
  readonly retainedConfirmation: (id: string) => Effect.Effect<string | null, WorkflowFailure>;
  readonly confirmationRecovered: (id: string) => Effect.Effect<void, WorkflowFailure>;
  readonly claim: () => Effect.Effect<readonly WorkflowPublication[], WorkflowFailure>;
  readonly complete: (publication: WorkflowPublication) => Effect.Effect<void, WorkflowFailure>;
  readonly failed: (publication: WorkflowPublication) => Effect.Effect<void, WorkflowFailure>;
  readonly quarantine: (
    id: string,
    payload: string,
    reason: string,
    target?: { readonly kind: 'wallpaper' | 'asset'; readonly id: string }
  ) => Effect.Effect<void, WorkflowFailure>;
  readonly recover: (id: string) => Effect.Effect<boolean, WorkflowFailure>;
}
export class WorkflowDelivery extends Context.Service<WorkflowDelivery, WorkflowDeliveryPort>()(
  'wallpaper/creation/Delivery'
) {}

export class WorkflowHealth extends Context.Service<
  WorkflowHealth,
  { readonly check: () => Effect.Effect<boolean> }
>()('wallpaper/creation/WorkflowHealth') {}
