import { Context, type Effect, Schema } from 'effect';
export class Unavailable extends Schema.TaggedError<Unavailable>()('Unavailable', {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}
export interface Time {
  now(): Effect.Effect<number, Unavailable>;
}
export const Time = Context.Service<Time>('wallpaperdb.factory.Time');
export interface ContinuationReceipt {
  readonly threadId: string;
  readonly index: number;
  readonly run: { readonly id: string; readonly ordinal: number };
}
/** Reserve capacity for the successor of an accepted, completed replay stage.
 * Configured scheduling retains the claim before any successor delivery. */
export interface ContinuationAdmission {
  authorize(issue: number, receipt: ContinuationReceipt): Effect.Effect<boolean, Unavailable>;
}
export const ContinuationAdmission = Context.Service<ContinuationAdmission>(
  'wallpaperdb.factory.ContinuationAdmission'
);
export interface Intent {
  readonly id: string;
  readonly issue: number;
  readonly issueUrl: string;
  readonly issueTitle?: string;
  readonly prerequisiteEvidence?: string;
  readonly prBase?: string;
  readonly base: string;
  readonly context: string;
  readonly branch: string;
  readonly createdAt: number;
  readonly expectedStage: 'implementation';
}
export type Observation =
  | { readonly kind: 'absent' }
  | { readonly kind: 'ambiguous' }
  | {
      readonly kind: 'found';
      readonly threadId: string;
      readonly status: string;
      readonly answeredQuestions?: readonly string[];
      readonly run?: { readonly id: string; readonly ordinal: number };
      readonly question?: { readonly id: string; readonly text: string };
      readonly worktree: string;
      readonly branch: string;
      readonly model: string;
    };
/** Atomic single-admission reservation; successful writes survive process/power loss.
 * Launch claims are durable and never automatically released, even after a crash.
 * This slice admits one job total. No implicit reset or retry of a launch. */
export interface JobStore {
  read(): Effect.Effect<Intent | null, Unavailable>;
  readControl(): Effect.Effect<Control, Unavailable>;
  /** Atomic revision compare-and-set. Commands and delivery claims share this journal. */
  saveControl(state: Control): Effect.Effect<boolean, Unavailable>;
  readWait(): Effect.Effect<WaitState | null, Unavailable>;
  /** Append atomically at revision; competing writers cannot overwrite a deadline or delivery identity. */
  saveWait(state: WaitState): Effect.Effect<boolean, Unavailable>;
  reserve(intent: Intent): Effect.Effect<boolean, Unavailable>;
  /** First binding per stage/run ordinal wins atomically and survives reopen. Repeating that
   * binding returns true; any replacement returns false. Records retain the
   * stage/thread/accepted commit and predecessor association for reconciliation. */
  bindRun(
    request: StageRequest,
    runId: string,
    ordinal?: number
  ): Effect.Effect<boolean, Unavailable>;
  /** Stage records are immutable. saveStage returns false if already present;
   * callers must use the winning record. Claims permit at most one uncertain
   * send per stage and are never automatically released. */
  readStage(index: number): Effect.Effect<StageRequest | null, Unavailable>;
  saveStage(request: StageRequest): Effect.Effect<boolean, Unavailable>;
  claimStage(index: number): Effect.Effect<boolean, Unavailable>;
  claimLaunch(): Effect.Effect<boolean, Unavailable>;
}
export interface AcceptedPublication {
  readonly url: string;
  readonly commit: string;
  readonly reviewedCommit?: string;
  readonly parent?: string;
  readonly base?: string;
}
export interface Control {
  /** Last verified ready or landed association survives external retargeting and restart.
   * Revalidation still gates all prerequisite use and external maintenance. */
  readonly prerequisite?: AcceptedPublication;
  readonly revision: number;
  readonly cancelled: boolean;
  readonly claimed: readonly number[];
  readonly parked?: {
    readonly run?: { readonly id: string; readonly ordinal: number };
    readonly index: number;
    readonly question: { readonly id: string; readonly text: string };
  };
}
export const JobStore = Context.Service<JobStore>('wallpaperdb.factory.JobStore');
export interface RecoveryStatus {
  readonly issue: number;
  readonly pr: string;
  readonly progress: string;
  /** Observation of the expected recovery worker; omitted for unlaunched/manual work. */
  readonly bindingAvailable?: boolean;
  readonly active?: boolean;
  readonly classification?: 'SIMPLE' | 'COMPLEX';
  readonly threadId?: string;
  readonly question?: string;
}
/** Scheduler authorization without a new issue admission. Recovery callers retain
 * their journal reservation; a validated completed-stage receipt instead asks
 * the scheduler to reserve that job's continuation before successor delivery. */
export type RecoveryAdmission = (
  issue: number,
  continuation?: ContinuationReceipt
) => Effect.Effect<boolean, Unavailable>;
export interface Issues {
  /** Verify a terminal publication against its retained reviewed correction and
   * reacquire that generation's writer claim. Never publishes or grants readiness. */
  claimPublicationRetry?(
    intent: Intent,
    request: StageRequest,
    evidence: StageEvidence
  ): Effect.Effect<boolean, Unavailable>;
  /** Coordinate a known replay repair with the publication journal. Review/publication
   * authority is supplied only after validating the current clean owning-stage receipt.
   * Review may reserve an unpublished correction; publication must confirm the exact head. */
  repairReplay?(
    intent: Intent,
    head: string,
    repaired?: string,
    authority?: { readonly request: StageRequest; readonly evidence: StageEvidence }
  ): Effect.Effect<boolean, Unavailable>;
  /** Observe recovery state and durably retain known adverse publication changes
   * before later maintenance. Restoration or verified landing is observed before clearing them. */
  recoveries?(): Effect.Effect<readonly RecoveryStatus[], Unavailable>;
  /** Reconcile durable joins and observe verified default-branch landings. May
   * reserve downstream maintenance from retained accepted publications, even
   * while admissions are paused or capacity is occupied. Record operation intent
   * before external changes; coordinate affected writers and expected-head leases.
   * New issue admissions are never performed by this operation. When supplied,
   * admitRecovery authorizes resumed review before capacity reservation and delivery. */
  reconcile?(admitRecovery?: RecoveryAdmission): Effect.Effect<void, Unavailable>;
  /** Prepare verified divergent prerequisites without admitting the child. Durable, leased,
   * writer-coordinated replay; inspect remains blocked until CI and metadata agree. */
  prepare?(issue: number, admitRecovery?: RecoveryAdmission): Effect.Effect<void, Unavailable>;
  /** Observe the bound publication and retain known adverse observations locally.
   * External refs and PR metadata are read-only at this boundary. */
  pullRequest(intent: Intent): Effect.Effect<PullRequestObservation, Unavailable>;
  /** A candidate is a previously selected launch comparison, not a replacement
   * operator pin. For prerequisites, return that exact base only after current
   * proof, original-pin containment and target compatibility are verified;
   * otherwise remain blocked/unavailable. No reservation or launch is changed. */
  inspect(
    issue: number,
    candidate?: { readonly base: string; readonly prBase?: string }
  ): Effect.Effect<
    {
      open: boolean;
      author: string;
      labels: readonly string[];
      /** Complete explicit blocking issue identities, including native and fallback edges. */
      blockers: readonly number[];
      prerequisite?: { readonly base: string; readonly prBase: string; readonly evidence: string };
      blockersReady: boolean;
      joinRequired?: boolean;
      recovery?: {
        readonly progress: string;
        readonly active?: boolean;
        readonly classification?: 'SIMPLE' | 'COMPLEX';
        readonly threadId?: string;
        readonly question?: string;
      };
      blockedReason?: string;
      url: string;
      title?: string;
    },
    Unavailable
  >;
}
export const Issues = Context.Service<Issues>('wallpaperdb.factory.Issues');
/** Launch may have succeeded on every failure. Observe must identify the exact title,
 * branch, model and isolated worktree; absence never authorizes a second launch. */
export interface Execution {
  /** Idempotent cancellation of this owning job, without cancelling unrelated threads. */
  interrupt(intent: Intent, threadId: string): Effect.Effect<void, Unavailable>;
  inspectStage(
    intent: Intent,
    request: StageRequest
  ): Effect.Effect<StageEvidence | null, Unavailable>;
  sendStage(intent: Intent, request: StageRequest): Effect.Effect<void, Unavailable>;
  launch(intent: Intent): Effect.Effect<{ kind: 'submitted' | 'uncertain' }, Unavailable>;
  /** A persisted owned replay stage may bind exact historical heads and repairs of its current commit. */
  observe(intent: Intent, repair?: StageRequest): Effect.Effect<Observation, Unavailable>;
}
export const Execution = Context.Service<Execution>('wallpaperdb.factory.Execution');
export interface Start {
  readonly issue: number;
  readonly prerequisiteEvidence?: string;
  readonly prBase?: string;
  readonly base: string;
  readonly context: string;
}
export type ResumeAction =
  | { index: number; questionId: string }
  | { index: number; runId: string; revision: number };
export type Resume = ResumeAction & { jobId: string };
export type Status =
  | { kind: 'empty' }
  | {
      kind: 'job';
      intent: Intent;
      prerequisite?: AcceptedPublication;
      execution: Observation;
      elapsedMs: number;
      resume?: ResumeAction;
      delivery?: Delivery;
    };
export type StartResult = Status | { kind: 'occupied' } | { kind: 'rejected' };
export interface Job {
  start(command: Start): Effect.Effect<StartResult, Unavailable>;
  status(): Effect.Effect<Status, Unavailable>;
  resume(command: Resume): Effect.Effect<StartResult, Unavailable>;
  cancel(jobId: string): Effect.Effect<StartResult, Unavailable>;
}
export const Job = Context.Service<Job>('wallpaperdb.factory.Job');

export type Stage = 'implementation' | 'review' | 'publication' | 'babysitting' | 'ci';
/** Immutable stage association, written before any delivery. Ordinal pins single-turn stages. Babysitting watcher turns also require the
 * exact stage delivery identity in their current-run receipt. */
export interface StageRequest {
  readonly comparison?: {
    readonly base: string;
    readonly prBase: string;
    readonly previousHead: string;
    readonly owningHeads?: readonly string[];
  };
  readonly index: number;
  readonly ordinal?: number;
  readonly continuation?: boolean;
  readonly resume?: boolean;
  readonly observedRunId?: string;
  /** Question already observed on this adopted run, retained atomically with its association. */
  readonly question?: { readonly id: string; readonly text: string };
  readonly deliveryIndex?: number;
  readonly stage: Stage;
  readonly threadId: string;
  readonly commit: string;
  readonly previousRunId: string | null;
}
export interface StageEvidence {
  readonly runId: string;
  readonly ordinal: number;
  readonly commit: string;
  readonly accepted: boolean;
  /** Actual owning worktree cleanliness when observed by the execution adapter. Absence is no proof. */
  readonly worktreeClean?: boolean;
  readonly waitingForGitHub?: boolean;
  /** Exact delivery association validated from the latest assistant receipt. */
  readonly stageIndex?: number;
  readonly linked?: readonly string[];
}
export type PullRequestObservation =
  | { readonly kind: 'absent' | 'ambiguous' }
  | {
      readonly kind: 'found';
      readonly url: string;
      readonly commit: string;
      /** Original accepted/reviewed commit of a durable issue-only replay. Current CI and maintenance still gate readiness. */
      readonly reviewedCommit?: string;
      readonly previousHead?: string;
      /** Exact previously verified issue-only heads, not arbitrary ancestors. */
      readonly owningHeads?: readonly string[];
      readonly parent?: string;
      readonly base?: string;
      readonly ci?: { readonly failed: boolean; readonly progress: string };
      readonly ready: boolean;
      readonly landed: boolean;
      readonly lifecycle?: string;
      /** Explicit closure or external divergence. Never grants readiness. */
      readonly manualRecovery?: boolean;
      /** Expected maintenance from durable publication/operation evidence,
       * awaiting its own CI/metadata verification.
       * Mutually exclusive with manualRecovery; retains active capacity. */
      readonly maintenancePending?: boolean;
    };
export interface Delivery {
  readonly stage: Stage | 'ci';
  readonly activity?:
    | 'repairing'
    | 'waiting-for-github'
    | 'continuation-pending'
    | 'awaiting-answer'
    | 'cancelled'
    | 'resume-pending'
    | 'manual-recovery';
  readonly active?: boolean;
  readonly question?: { readonly id: string; readonly text: string };
  readonly deadline?: number;
  readonly commit: string;
  readonly ready: boolean;
  readonly landed: boolean;
  readonly pr?: PullRequestObservation;
  readonly reviewedCommit?: string;
}

export interface WaitState {
  readonly revision: number;
  readonly progress: string;
  readonly deadline: number;
  readonly nudged: boolean;
  readonly continuation?: StageRequest;
}
