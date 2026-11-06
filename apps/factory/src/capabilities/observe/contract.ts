import type { ScheduleStatus } from '../plan/index.js';
import { Context, type Effect } from 'effect';
import type { Unavailable, Status } from '../job/index.js';
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
    id: string;
    name: string;
    state: 'passed' | 'failed' | 'running' | 'queued' | 'skipped' | 'neutral' | 'unknown';
    url: string | null;
    head: string;
    startedAt: string | null;
    completedAt: string | null;
  }[];
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
  issues: readonly IssueObservation[];
  pullRequests: readonly PullObservation[];
}
export interface ObservationState {
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
    state: Pick<ObservationState, 'startedAt' | 'observedAt' | 'failedAt' | 'error' | 'facts'>
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
export interface ObservationSource {
  read(): Effect.Effect<Facts, Unavailable>;
}
export const ObservationSource = Context.Service<ObservationSource>(
  'wallpaperdb.factory.ObservationSource'
);
// Full GitHub refresh: immediate at startup, then every two minutes without overlap.
// Facts become stale after two missed refresh opportunities; age is exposed even while loading.
export const observationRefreshIntervalMs = 120_000;
export const observationStaleAfterMs = 2 * observationRefreshIntervalMs;
export type ObservationSnapshot = ObservationState & {
  ageMs?: number;
  stale: boolean;
  state: 'initial' | 'loading' | 'current' | 'stale' | 'error';
};
export interface LocalWork {
  intent: import('../job/index.js').Intent | null;
  control: import('../job/index.js').Control;
}
export interface ScheduleSnapshot extends ScheduleStatus {
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
