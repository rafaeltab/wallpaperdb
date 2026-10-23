import { Context, Data, type Effect } from 'effect';

export class CleanupFailure extends Data.TaggedError('CleanupFailure')<{
  readonly operation: string;
  readonly cause: unknown;
}> {}
export type CleanupTarget =
  | { readonly kind: 'candidate'; readonly candidateId: string }
  | { readonly kind: 'source'; readonly assetId: string; readonly sourceId: string };
/** Replaces only the exact reserved identity with a compact, empty reclamation
 * fence. Replay and a lost success are safe. Conditional immutable writers cannot
 * restore bytes after reclamation, including a write arriving after this step. */
export class CleanupBytes extends Context.Service<
  CleanupBytes,
  {
    readonly reclaim: (target: CleanupTarget) => Effect.Effect<void, CleanupFailure>;
  }
>()('asset/cleanup/Bytes') {}
