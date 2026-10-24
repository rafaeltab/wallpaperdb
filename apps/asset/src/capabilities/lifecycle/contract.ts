import { Context, Data, type Effect } from 'effect';

export interface Owner {
  readonly namespace: string;
  readonly subject: string;
}
export interface Correlation {
  readonly commandId: string;
  readonly applicationReference: string;
}
export type Command = Correlation &
  (
    | { readonly operation: 'create'; readonly assetType: string; readonly ownerSubject: string }
    | { readonly operation: 'delete'; readonly assetId: string }
    | {
        readonly operation: 'create' | 'delete';
        readonly invalid: true;
        readonly payloadIdentity: string;
      }
  );
export type Rejection =
  | 'malformed-command'
  | 'idempotency-conflict'
  | 'forbidden-operation'
  | 'unsupported-type'
  | 'unavailable-asset';
export type CommandResult = Correlation &
  (
    | { readonly outcome: 'created'; readonly assetId: string }
    | { readonly outcome: 'rejected'; readonly assetId: string | null; readonly reason: Rejection }
  );
export interface OwnedAsset {
  readonly id: string;
  readonly applicationId: string;
  readonly assetType: string;
  readonly owner: Owner;
}
export class LifecycleFailure extends Data.TaggedError('LifecycleFailure')<{
  readonly operation: string;
  readonly cause: unknown;
}> {}
export interface Acceptance {
  readonly context: CommandContext;
  readonly revision: string;
  readonly applicationId: string;
  readonly canonical: string;
  readonly correlation: Correlation;
  readonly decision:
    | { readonly kind: 'create'; readonly assetType: string; readonly owner: Owner }
    | { readonly kind: 'reject'; readonly reason: Rejection };
}
/** Atomically records (application, command), assigns a non-reused Asset identity,
 * and records the result outbox. Canonical payload includes operation. Equal
 * replay returns the original result, conflicting reuse records a safe rejection.
 * Every write fences the active revision in the same transaction. No external I/O
 * participates in that transaction. A lost COMMIT response is resolved by replay. */
export interface LifecycleStorePort {
  readonly accept: (input: Acceptance) => Effect.Effect<CommandResult, LifecycleFailure>;
  readonly find: (assetId: string) => Effect.Effect<OwnedAsset | null, LifecycleFailure>;
}
export class LifecycleStore extends Context.Service<LifecycleStore, LifecycleStorePort>()(
  'asset/lifecycle/Store'
) {}
export interface ResultPublication {
  readonly context: CommandContext;
  readonly id: string;
  readonly leaseId: string;
  readonly applicationId: string;
  readonly result: CommandResult;
  readonly occurredAt: string;
  readonly attempts: number;
}
/** Notification identity is independent of the business result. It is durable
 * through retries/restart and renewed atomically only by accepted recovery. */
export interface ResultAlert {
  readonly id: string;
  readonly notificationOccurrence: string;
  readonly applicationId: string;
  readonly context: CommandContext;
}
/** Claims are leased across replicas. Results retain stable occurrence identity
 * through ambiguous publication and restart. Failure increments a durable finite
 * attempt counter; exhausted work remains inspectable until operator recovery.
 * Acknowledgements match both the duty and its current unresolved quarantine occurrence. */
export interface ResultOutboxPort {
  readonly pendingAlerts: (
    limit: number
  ) => Effect.Effect<readonly ResultAlert[], LifecycleFailure>;
  readonly alerted: (alert: ResultAlert) => Effect.Effect<void, LifecycleFailure>;
  /** Only trusted operator composition exposes deliberate recovery. Replaying a command does not reset exhausted publication attempts. */
  readonly recover: (id: string) => Effect.Effect<boolean, LifecycleFailure>;
  readonly claim: (limit: number) => Effect.Effect<readonly ResultPublication[], LifecycleFailure>;
  readonly published: (publication: ResultPublication) => Effect.Effect<void, LifecycleFailure>;
  readonly failed: (publication: ResultPublication) => Effect.Effect<void, LifecycleFailure>;
}
export class ResultOutbox extends Context.Service<ResultOutbox, ResultOutboxPort>()(
  'asset/lifecycle/ResultOutbox'
) {}
export interface LifecyclePolicy {
  readonly revision: string;
  readonly applications: Readonly<
    Record<
      string,
      {
        readonly ownerNamespace: string;
        readonly allowedOperations: readonly string[];
        readonly allowedTypes: readonly string[];
      }
    >
  >;
}
export interface AssetInspection {
  readonly assetId: string;
  readonly assetType: string;
  readonly sources: readonly never[];
  readonly defaultSourceId: null;
  readonly sourceSetRevision: '0';
}
export interface LifecyclePort {
  readonly command: (
    applicationId: string,
    command: Command,
    context: CommandContext
  ) => Effect.Effect<CommandResult, LifecycleFailure>;
  readonly inspect: (
    owner: Owner,
    assetId: string
  ) => Effect.Effect<
    { readonly kind: 'found'; readonly asset: AssetInspection } | { readonly kind: 'unavailable' },
    LifecycleFailure
  >;
}
export interface CommandContext {
  readonly occurrence: { readonly source: string; readonly id: string };
  readonly correlationId?: string;
  readonly traceparent?: string;
  readonly tracestate?: string;
}
export class Lifecycle extends Context.Service<Lifecycle, LifecyclePort>()(
  'asset/lifecycle/Lifecycle'
) {}
