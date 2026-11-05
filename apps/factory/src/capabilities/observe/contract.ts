import { Context, type Effect } from 'effect';
import type { Unavailable, Status } from '../job/index.js';
export interface IssueObservation {
  number: number;
  url: string;
  title: string;
  open: boolean;
  candidate: boolean;
  labels: readonly string[];
  assignees: readonly string[];
  projectStatus: string | null;
  commentCount: number;
  blockers: readonly number[];
  parents: readonly number[];
  pullRequests: readonly number[];
}
export interface PullObservation {
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
export interface Observations {
  snapshot(): Effect.Effect<
    ObservationState & { state: 'initial' | 'loading' | 'current' | 'stale' | 'error' },
    Unavailable
  >;
  refresh(): Effect.Effect<void, Unavailable>;
  schedule(): Effect.Effect<
    import('../plan/index.js').ScheduleStatus & {
      observations: ObservationState;
      relationships?: readonly { issue: number; blockers: readonly number[] }[];
    },
    Unavailable
  >;
}
export const Observations = Context.Service<Observations>('wallpaperdb.factory.Observations');

export interface LocalSnapshot {
  read(): Effect.Effect<
    {
      state: import('../plan/index.js').ScheduleState;
      entries: readonly {
        intent: import('../job/index.js').Intent | null;
        control: import('../job/index.js').Control;
      }[];
    },
    Unavailable
  >;
}
export const LocalSnapshot = Context.Service<LocalSnapshot>('wallpaperdb.factory.LocalSnapshot');
