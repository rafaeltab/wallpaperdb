import { Context, type Effect, type Option } from 'effect';
import type { Status, Unavailable, RecoveryStatus } from '../job/index.js';
export interface PlanningIssue {
  readonly metadata?: {
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
    pullRequests: readonly { number: number; url: string; state: 'OPEN' | 'CLOSED' | 'MERGED' }[];
  };
  readonly number: number;
  readonly url: string;
  readonly title: string;
  readonly body: string;
  readonly author: string;
  readonly open: boolean;
  readonly labels: readonly string[];
  readonly comments: readonly { author: string; body: string }[];
  readonly blockers: readonly number[];
  readonly parents: readonly number[];
  readonly blockersReady: boolean;
  readonly joinRequired?: boolean;
  readonly recovery?: {
    readonly progress: string;
    readonly active?: boolean;
    readonly classification?: 'SIMPLE' | 'COMPLEX';
    readonly threadId?: string;
    readonly question?: string;
  };
  readonly blockedReason?: string;
  readonly prerequisiteEvidence: string;
  readonly prerequisite?: {
    readonly base: string;
    readonly prBase: string;
    readonly evidence: string;
  };
}
export interface PlanningInput {
  /** Maximum new issues that current free slots and permanent admissions permit. */
  readonly maximumSelections?: number;
  readonly availableCode?: readonly {
    readonly issue: number;
    readonly pr: number;
    readonly commit: string;
  }[];
  readonly issues: readonly PlanningIssue[];
  readonly job: Status;
  readonly jobs?: readonly Status[];
  readonly scheduleRevision?: number;
  readonly admissions?: readonly number[];
  readonly paused?: boolean;
  readonly capacity: { readonly concurrency: number; readonly admission: number };
}
/** Complete bounded discovery, including parent and blocker context. Failure must not yield partial facts. */
export interface PlanningSource {
  /** Read-only verification of the exact requested code and mandatory blockers. Allows
   * verified divergent code whose automatic base construction remains in this cycle. */
  verify(selection: Proposal['selected'][number]): Effect.Effect<string | undefined, Unavailable>;
  /** Periodic discovery may coalesce demand without returning cached authority.
   * Undefined means no new observation; explicit previews and freshness checks use read. */
  poll?(): Effect.Effect<PlanningInput | undefined, Unavailable>;
  read(): Effect.Effect<PlanningInput, Unavailable>;
}
export const PlanningSource = Context.Service<PlanningSource>('wallpaperdb.factory.PlanningSource');
export interface Proposal {
  readonly selected: readonly {
    issue: number;
    reason: string;
    includeCodeFromIssues: readonly number[];
  }[];
  readonly deferred: readonly { issue: number; reason: string }[];
}
/** Preview only. No adapter may dispatch implementation work. */
export interface IPlanner {
  /** Observe exact bound ownership, including late completion, before blocking retries.
   * Unbound claims remain uncertain. Never launches a worker. With reconcile=false
   * or an exact requestId, read retained ownership without provider calls or mutations. */
  ownership(
    reconcile?: boolean,
    requestId?: string
  ): Effect.Effect<PlannerOwnership | undefined, Unavailable>;
  propose(
    input: PlanningInput,
    attempt?: {
      requestId?: string;
      deadline?: number;
      automatic?: boolean;
      attemptStartedAt?: number;
    }
  ): Effect.Effect<Proposal | { readonly kind: 'paused' }, Unavailable>;
}
export const IPlanner = Context.Service<IPlanner>('wallpaperdb.factory.IPlanner');
export interface Preview {
  readonly modelAttemptId?: string;
  readonly kind: 'preview' | 'stale' | 'paused';
  readonly selected: Proposal['selected'];
  readonly rejected: readonly { issue: number; reason: string }[];
  readonly input: PlanningInput;
}
export interface Plan {
  preview(attempt?: {
    maximumSelections?: number;
    requestId?: string;
    automatic?: boolean;
    attemptStartedAt?: number;
    progress: (phase: 'discovery' | 'handoff' | 'freshness') => Effect.Effect<void, Unavailable>;
  }): Effect.Effect<Preview, Unavailable>;
}
export const Plan = Context.Service<Plan>('wallpaperdb.factory.Plan');

export interface ResumeClaim {
  readonly retryThreadId?: string;
  readonly issue: number;
  readonly index: number;
  readonly questionId?: string;
  readonly runId?: string;
  readonly run?: { readonly id: string; readonly ordinal: number };
}
export interface ExecutionCycle {
  readonly requestId: string;
  readonly startedAt: number;
  /** Absent until a validated selection is durably accepted. Never a queue of future work. */
  readonly selected?: Proposal['selected'];
  readonly scope?: string;
  readonly modelAttemptId?: string;
  readonly bases?: readonly { readonly issue: number; readonly base: string }[];
  readonly concurrency: number;
  readonly allowance: number;
}
export interface ScheduleState {
  /** Stable across internal cycle bookkeeping; changes with configured controls. */
  readonly controlsRevision?: number;
  readonly cycle?: ExecutionCycle;
  /** An authorization whose recovery journal has not yet been observed. */
  readonly recovering?: readonly number[];
  readonly revision: number;
  readonly concurrency: number;
  readonly allowance: number;
  readonly paused: boolean;
  /** Durable active-slot claims for resumption or completed-stage continuation,
   * including uncertain sends, without another distinct admission. */
  readonly resuming?: readonly ResumeClaim[];
  /** Distinct reservations are permanent, including uncertain starts. */
  readonly admissions: readonly import('../job/index.js').Start[];
}
/** Atomic revision compare-and-set of controls and all admission reservations.
 * A successful save is durable before any job launch. */
export interface ScheduleStore {
  /** Exclusive process-independent execution-cycle ownership. Busy returns None, never
   * waits recursively. Release on interruption/process exit; retained batch state survives. */
  withCycle<A>(work: Effect.Effect<A, Unavailable>): Effect.Effect<Option.Option<A>, Unavailable>;
  read(): Effect.Effect<ScheduleState, Unavailable>;
  save(state: ScheduleState): Effect.Effect<boolean, Unavailable>;
}
export const initialScheduleState: ScheduleState = {
  revision: -1,
  concurrency: 1,
  allowance: 1,
  paused: false,
  admissions: [],
};
export const ScheduleStore = Context.Service<ScheduleStore>('wallpaperdb.factory.ScheduleStore');
/** Stable isolated lifecycle per issue, including after reopening the runtime. */
export interface JobPool {
  job(issue: number): Effect.Effect<import('../job/index.js').Job, Unavailable>;
}
export const JobPool = Context.Service<JobPool>('wallpaperdb.factory.JobPool');
export interface ScheduleStatus {
  readonly recoveries?: readonly RecoveryStatus[];
  readonly state: ScheduleState;
  readonly jobs: readonly Status[];
}
/** Persist each completed external observation before downstream planning can block or fail.
 * Snapshot reads never invoke this port. It publishes no admission authority.
 * A technical publication failure aborts the current operation before downstream
 * planning/admission; it must not be represented as successfully published facts. */
export interface ScheduleObservations {
  publish(snapshot: ScheduleStatus): Effect.Effect<void, Unavailable>;
}
export const ScheduleObservations = Context.Service<ScheduleObservations>(
  'wallpaperdb.factory.ScheduleObservations'
);
export interface Scheduler {
  retry(
    command: import('../job/index.js').Retry,
    revision: number
  ): Effect.Effect<import('../job/index.js').StartResult, Unavailable>;
  /** Check recovery capacity without another issue admission. Recovery journals
   * retain their active reservation. A validated completed-stage receipt reserves
   * a durable job slot here before its successor stage can be sent. */
  authorizeRecovery(
    issue: number,
    continuation?: import('../job/index.js').ContinuationReceipt
  ): Effect.Effect<boolean, Unavailable>;
  status(): Effect.Effect<ScheduleStatus, Unavailable>;
  configure(command: {
    revision: number;
    concurrency: number;
    allowance: number;
    paused: boolean;
  }): Effect.Effect<'saved' | 'conflict' | 'rejected' | 'acknowledgement-required', Unavailable>;
  tick(base: string): Effect.Effect<ScheduleStatus, Unavailable>;
  start(
    command: import('../job/index.js').Start
  ): Effect.Effect<import('../job/index.js').StartResult, Unavailable>;
  resume(
    command: import('../job/index.js').Resume
  ): Effect.Effect<import('../job/index.js').StartResult, Unavailable>;
  cancel(jobId: string): Effect.Effect<import('../job/index.js').StartResult, Unavailable>;
}
export const Scheduler = Context.Service<Scheduler>('wallpaperdb.factory.Scheduler');

export interface PlannerOwnership {
  requestId: string;
  revision: number;
  deadline?: number;
  phase?: 'launch-intent' | 'running' | 'succeeded' | 'failed' | 'uncertain';
  run?: { threadId: string; runId: string };
  retired?: boolean;
  detail?: string;
  automatic?: boolean;
  attemptStartedAt?: number;
  modelHandedOffAt?: number;
}
export interface AttemptResult {
  kind: Exclude<Preview['kind'], 'paused'>;
  selected: Preview['selected'];
  rejected: Preview['rejected'];
  input: {
    issues: readonly {
      number: number;
      title: string;
      blockers: readonly number[];
      parents: readonly number[];
      recovery?: PlanningIssue['recovery'];
    }[];
  };
}
export interface PlanningAttempt {
  id: string;
  revision: number;
  startedAt: number;
  /** Legacy persisted attempt metadata. Model timing is owned by PlannerOwnership. */
  deadline: number;
  phase: 'discovery' | 'handoff' | 'freshness' | 'succeeded' | 'failed';
  finishedAt?: number;
  detail?: string;
  result?: AttemptResult;
}
/** Atomic creation excludes concurrent unfinished attempts. Updates compare revisions,
 * preserve identity/start/deadline and return false on conflicts. */
export interface AttemptStore {
  latest?(): Effect.Effect<PlanningAttempt | undefined, Unavailable>;
  pending(): Effect.Effect<PlanningAttempt | undefined, Unavailable>;
  get(id: string): Effect.Effect<PlanningAttempt | undefined, Unavailable>;
  create(attempt: PlanningAttempt): Effect.Effect<boolean, Unavailable>;
  save(attempt: PlanningAttempt): Effect.Effect<boolean, Unavailable>;
}
export const AttemptStore = Context.Service<AttemptStore>('wallpaperdb.factory.AttemptStore');
export interface Attempts {
  submit(id: string): Effect.Effect<AttemptSubmission, Unavailable>;
  observe(id: string): Effect.Effect<
    | (Omit<PlanningAttempt, 'phase' | 'deadline'> & {
        deadline: number | null;
        phase: string;
        elapsedMs: number;
        launch?: PlannerOwnership;
      })
    | undefined,
    Unavailable
  >;
  pending(): Effect.Effect<PlanningAttempt | undefined, Unavailable>;
  execute(id: string): Effect.Effect<void, Unavailable>;
}
export const Attempts = Context.Service<Attempts>('wallpaperdb.factory.Attempts');

export type AttemptSubmission =
  | { kind: 'accepted'; id: string }
  | { kind: 'busy'; id: string }
  | { kind: 'conflict' }
  | { kind: 'blocked'; requestId: string; reason: 'outstanding' | 'reconciliation-required' };
