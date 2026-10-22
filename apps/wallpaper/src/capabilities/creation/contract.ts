import { Context, Data, type Effect } from 'effect';
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
}
export interface CreationPort {
  readonly list: (owner: Creator) => Effect.Effect<readonly Wallpaper[], WorkflowFailure>;
  readonly begin: (owner: Creator, key: string) => Effect.Effect<WallpaperOutcome, WorkflowFailure>;
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
  readonly begin: (owner: Creator, key: string) => Effect.Effect<Wallpaper, WorkflowFailure>;
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
  readonly attempts: number;
}
/** Leased claims survive restart. Publication is complete only after broker PubAck.
 * Exhausted attempts remain quarantined with their original identity, never reset
 * by an HTTP retry. Recovery is available only to trusted operator composition. */
export interface WorkflowDeliveryPort {
  readonly claim: () => Effect.Effect<readonly WorkflowPublication[], WorkflowFailure>;
  readonly complete: (publication: WorkflowPublication) => Effect.Effect<void, WorkflowFailure>;
  readonly failed: (publication: WorkflowPublication) => Effect.Effect<void, WorkflowFailure>;
  readonly quarantine: (
    id: string,
    payload: string,
    reason: string
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
