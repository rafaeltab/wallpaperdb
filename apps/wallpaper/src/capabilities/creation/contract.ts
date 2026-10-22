import { Context, Data, type Effect } from 'effect';
export interface Creator {
  readonly namespace: string;
  readonly subject: string;
}
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
