import { Context, Data, type Effect } from 'effect';

export class CleanupFailure extends Data.TaggedError('CleanupFailure')<{
  readonly operation: string;
  readonly cause: unknown;
}> {}
export type CleanupTarget =
  | { readonly kind: 'candidate'; readonly candidateId: string }
  | { readonly kind: 'source'; readonly assetId: string; readonly sourceId: string };
export interface CleanupWork {
  readonly id: string;
  readonly leaseId: string;
  readonly attempts: number;
  readonly target: CleanupTarget;
}
/** Claim atomically rechecks recorded expiry, current membership and read
 * protection under the Asset serialization boundary. Claims are bounded and
 * recover after restart; exhausted claims quarantine until deliberate recovery.
 * Completion/failure compare the exact claim lease, never a newer worker's lease. */
export class CleanupStore extends Context.Service<
  CleanupStore,
  {
    readonly claim: (limit: number) => Effect.Effect<readonly CleanupWork[], CleanupFailure>;
    readonly completed: (work: CleanupWork) => Effect.Effect<void, CleanupFailure>;
    readonly failed: (work: CleanupWork) => Effect.Effect<void, CleanupFailure>;
    readonly pendingAlerts: () => Effect.Effect<
      readonly {
        readonly id: string;
        readonly applicationId: string;
        readonly notificationId: string;
      }[],
      CleanupFailure
    >;
    readonly alerted: (id: string, notificationId: string) => Effect.Effect<void, CleanupFailure>;
    readonly recover: (id: string) => Effect.Effect<boolean, CleanupFailure>;
  }
>()('asset/cleanup/Store') {}
export class Cleanup extends Context.Service<
  Cleanup,
  {
    readonly run: (
      limit: number
    ) => Effect.Effect<{ readonly completed: number; readonly failed: number }, CleanupFailure>;
  }
>()('asset/cleanup/Cleanup') {}
/** Replaces only the exact reserved identity with a compact, empty reclamation
 * fence. Replay and a lost success are safe. Conditional immutable writers cannot
 * restore bytes after reclamation, including a write arriving after this step. */
export class CleanupBytes extends Context.Service<
  CleanupBytes,
  {
    readonly reclaim: (target: CleanupTarget) => Effect.Effect<void, CleanupFailure>;
  }
>()('asset/cleanup/Bytes') {}
