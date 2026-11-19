import type { ScheduleStatus } from '../plan/index.js';
import { Context, type Effect } from 'effect';
import type { Unavailable, Status } from '../job/index.js';
/** One applied observation and its resume position form an indivisible checkpoint.
 * Revisions fence obsolete background work, including replacement snapshots.
 * The serialized observation belongs to the external observation adapter. */
export interface ObservationCheckpoint {
  readonly revision: number;
  readonly sequence: number;
  readonly value: string;
  readonly entities?: readonly { readonly id: string; readonly value: string }[];
}
export interface ObservationCheckpointUpdate {
  readonly sequence: number;
  readonly value: string;
  /** Apply entity changes and cursor in the same transaction. null removes an entity. */
  readonly entities?: readonly { readonly id: string; readonly value: string | null }[];
  /** Authoritative snapshots replace the prior entity set atomically. */
  readonly replaceEntities?: boolean;
}
export interface ObservationCheckpoints {
  read: (stream: string) => Effect.Effect<ObservationCheckpoint | null, Unavailable>;
  publish: (
    stream: string,
    expectedRevision: number,
    checkpoint: ObservationCheckpointUpdate
  ) => Effect.Effect<boolean, Unavailable>;
}
export const ObservationCheckpoints = Context.Service<ObservationCheckpoints>(
  'wallpaperdb.factory.ObservationCheckpoints'
);
export interface ObservedUser {
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  url: string;
}
export interface ObservedLabel {
  id: string;
  name: string;
  color: string;
}
export interface ObservedChoice {
  id: string;
  name: string;
  rank: number | null;
}
export interface IssueObservation {
  author?: string;
  evaluation?: {
    allowed: boolean;
    blockersReady: boolean;
    verifiedAt: number;
    prerequisites: readonly {
      issue: number;
      pr: number;
      commit: string;
      parent?: string;
      prBase?: string;
      basis: 'verified-unmerged' | 'verified-landed';
    }[];
  };
  updatedAt?: string;
  labelDetails?: readonly ObservedLabel[];
  assigneeDetails?: readonly ObservedUser[];
  projectDetails?: {
    projectId: string | null;
    status: ObservedChoice | null;
    priority: ObservedChoice | null;
    size: ObservedChoice | null;
  };
  nativeParent?: number | null;
  nativeBlockers?: readonly number[];
  number: number;
  url: string;
  title: string;
  open: boolean;
  candidate: boolean;
  labels: readonly string[];
  assignees: readonly string[];
  projectStatus: string | null;
  projectPriority: string | null;
  projectSize: string | null;
  commentCount: number;
  blockers: readonly number[];
  parents: readonly number[];
  pullRequests: readonly number[];
}
export interface PullObservation {
  title?: string;
  draft?: boolean;
  updatedAt?: string;
  mergeability?: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  labelDetails?: readonly ObservedLabel[];
  checkRuns?: readonly {
    requirement?: 'required' | 'optional' | 'unknown';
    id: string;
    name: string;
    state: 'passed' | 'failed' | 'running' | 'queued' | 'skipped' | 'neutral' | 'unknown';
    url: string | null;
    head: string;
    startedAt: string | null;
    completedAt: string | null;
  }[];
  reviewersComplete?: boolean;
  reviewers?: readonly {
    user: ObservedUser;
    state: 'requested' | 'approved' | 'changes-requested' | 'commented' | 'dismissed';
    submittedAt: string | null;
    head: string | null;
  }[];
  number: number;
  url: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  head: string;
  headBranch: string;
  base: string;
  baseBranch: string;
  /** Explicit GitHub closing references, separate from incidental cross references. */
  linkedIssues: readonly number[];
  crossReferencedIssues: readonly number[];
  review: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | 'UNKNOWN';
  ci: 'SUCCESS' | 'FAILURE' | 'PENDING' | 'UNKNOWN';
  evidenceHead: string;
}
export interface Facts {
  verifiedPrBases?: readonly { base: number; tip: number }[];
  issues: readonly IssueObservation[];
  pullRequests: readonly PullObservation[];
}
export interface ItemFreshness {
  generation: number;
  sequence: number;
  attemptedAt: number;
  observedAt?: number;
  failedAt?: number;
  error?: string;
}
export type ItemObservation = {
  /** Buffered batches can combine independently ordered collections in one commit. */
  generation?: number;
  sequence: number;
  at: number;
} & (
  | { kind: 'issue'; value: IssueObservation }
  | { kind: 'pull'; value: PullObservation }
  | { kind: 'job'; value: Extract<Status, { kind: 'job' }> }
  | { kind: 'failure'; key: string; error: string }
);
/** Generations survive restart. Each batch atomically accepts only newer item versions.
 * Failures retain the previous complete value and successful observation date.
 * Publication never grants execution authority or removes absent items.
 */
export interface ReportingStore {
  begin(): Effect.Effect<number, Unavailable>;
  publish(generation: number, items: readonly ItemObservation[]): Effect.Effect<void, Unavailable>;
}
export const ReportingStore = Context.Service<ReportingStore>('wallpaperdb.factory.ReportingStore');
export interface ReportingState {
  completedGeneration?: number;
  generation: number;
  items: Record<string, ItemFreshness>;
}
export interface ObservationState {
  items?: Record<string, ItemFreshness>;
  startedAt?: number;
  observedAt?: number;
  failedAt?: number;
  error?: string;
  facts?: Facts;
  recoveries?: readonly import('../job/index.js').RecoveryStatus[];
  jobs?: readonly Status[];
  jobsObservedAt?: number;
}
/** Reads are local only. Failed refreshes preserve the last complete useful facts. */
export interface ObservationStore {
  read(): Effect.Effect<ObservationState, Unavailable>;
  refresh(
    state: Pick<ObservationState, 'startedAt' | 'observedAt' | 'failedAt' | 'error' | 'facts'> & {
      generation?: number;
    }
  ): Effect.Effect<void, Unavailable>;
  jobs(
    jobs: readonly Status[],
    observedAt: number,
    recoveries?: readonly import('../job/index.js').RecoveryStatus[]
  ): Effect.Effect<void, Unavailable>;
}
export const ObservationStore = Context.Service<ObservationStore>(
  'wallpaperdb.factory.ObservationStore'
);
export type CollectedObservation =
  | { kind: 'issue'; value: IssueObservation }
  | { kind: 'pull'; value: PullObservation }
  | { kind: 'failure'; key: string; error: string };
export interface ObservationSource {
  read(
    publish?: (item: CollectedObservation) => Effect.Effect<void, Unavailable>
  ): Effect.Effect<Facts, Unavailable>;
}
export const ObservationSource = Context.Service<ObservationSource>(
  'wallpaperdb.factory.ObservationSource'
);
// Coalesced metadata demand waits at least five minutes between collections.
// Provider budgeting may delay it further. Idle services do not collect metadata.
export const observationRefreshIntervalMs = 300_000;
// Freshness is independent of whether demand or provider capacity permits a refresh.
export const observationStaleAfterMs = 240_000;
export type ObservationSnapshot = ObservationState & {
  /** Live owner evidence, never restored from persistence. */
  refreshActive?: boolean;
  ageMs?: number;
  stale: boolean;
  state: 'initial' | 'loading' | 'current' | 'stale' | 'error';
};
export interface LocalWork {
  intent: import('../job/index.js').Intent | null;
  control: import('../job/index.js').Control;
}
export interface ScheduleSnapshot extends ScheduleStatus {
  executionCatalog?: import('../job/index.js').ExecutionCatalog;
  /** Local coordination owners can establish inactivity without instrumenting later categories. */
  coordinationIdle?: boolean;
  planningSafety?: import('../plan/index.js').PlanningSafetyView;
  threads?: ThreadSnapshot;
  observations: ObservationSnapshot;
  localWork: readonly LocalWork[];
  relationships?: readonly { issue: number; blockers: readonly number[] }[];
}
export interface Observations {
  snapshot(): Effect.Effect<ObservationSnapshot, Unavailable>;
  refresh(): Effect.Effect<void, Unavailable>;
  schedule(): Effect.Effect<ScheduleSnapshot, Unavailable>;
}
export const Observations = Context.Service<Observations>('wallpaperdb.factory.Observations');

export interface LocalSnapshot {
  read(): Effect.Effect<
    {
      state: import('../plan/index.js').ScheduleState;
      entries: readonly LocalWork[];
    },
    Unavailable
  >;
}
export const LocalSnapshot = Context.Service<LocalSnapshot>('wallpaperdb.factory.LocalSnapshot');

export interface ThreadMetadata {
  threadId: string;
  title: string;
  createdAt: string | null;
  updatedAt: string | null;
  status: string;
  branch: string | null;
  worktree: string | null;
  associations?: readonly {
    issue: number;
    evidence: 'factory-binding' | 'github-closing-reference';
    observedAt: number | null;
  }[];
  associationState?: 'absent' | 'evidenced' | 'conflicting' | 'unavailable';
  pullRequests: readonly { repository: string; number: number; url: string }[];
}
export interface ThreadFacts {
  environmentId: string;
  projectId: string;
  threads: readonly ThreadMetadata[];
}
export interface ThreadState {
  startedAt?: number;
  observedAt?: number;
  failedAt?: number;
  error?: string;
  facts?: ThreadFacts;
}
export type ThreadSnapshot = ThreadState & {
  state: 'initial' | 'loading' | 'current' | 'stale' | 'error';
  ageMs?: number;
  stale: boolean;
  browserOrigin?: string;
};
/** Local reads initially return {}. save atomically replaces the complete snapshot,
 * removing fields omitted by the caller, including obsolete failure/loading state.
 * Metadata is never execution or planner authority.
 */
export interface ThreadStore {
  read(): Effect.Effect<ThreadState, Unavailable>;
  save(value: ThreadState): Effect.Effect<void, Unavailable>;
}
export const ThreadStore = Context.Service<ThreadStore>('wallpaperdb.factory.ThreadStore');
export interface ThreadSource {
  read(): Effect.Effect<ThreadFacts, Unavailable>;
}
export const ThreadSource = Context.Service<ThreadSource>('wallpaperdb.factory.ThreadSource');
export interface Threads {
  snapshot(): Effect.Effect<ThreadSnapshot, Unavailable>;
  refresh(): Effect.Effect<void, Unavailable>;
}
export const Threads = Context.Service<Threads>('wallpaperdb.factory.Threads');

export interface Reporting {
  begin(): Effect.Effect<number, Unavailable>;
  enqueue(generation: number, items: readonly ItemObservation[]): Effect.Effect<void, Unavailable>;
  immediate(
    generation: number,
    items: readonly ItemObservation[]
  ): Effect.Effect<void, Unavailable>;
  flush(): Effect.Effect<void, Unavailable>;
}
export const Reporting = Context.Service<Reporting>('wallpaperdb.factory.Reporting');
