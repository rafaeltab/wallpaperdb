import { Context, type Effect, Schema } from 'effect';
export class Unavailable extends Schema.TaggedError<Unavailable>()('Unavailable', {
  operation: Schema.String,
  cause: Schema.Defect(),
  /** Positive proof that a launch preparation failed before any external send. */
  launchNotSent: Schema.optional(Schema.Literal(true)),
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
export interface ExecutionSettings {
  readonly model: string;
  /** Null preserves the installation's inherited/default selection. */
  readonly effort: string | null;
  readonly mode: 'standard' | 'fast' | null;
  readonly permissionLevel:
    | 'approval-required'
    | 'auto-accept-edits'
    | 'auto'
    | 'full-access'
    | null;
}
export interface ObservedExecution {
  readonly model: string;
  readonly effort: string | null;
  readonly serviceTier: string | null;
  readonly permissionLevel: string;
}
export interface ExecutionCatalog {
  readonly models: readonly {
    readonly id: string;
    readonly efforts: readonly string[];
    readonly modes: readonly ('standard' | 'fast')[];
  }[];
  readonly permissionLevels: readonly Exclude<ExecutionSettings['permissionLevel'], null>[];
}
export interface ExecutionConfiguration {
  /** Include the requested model when supported, even if omitted from the default listing. */
  catalog(model?: string): Effect.Effect<ExecutionCatalog, Unavailable>;
}
export const ExecutionConfiguration = Context.Service<ExecutionConfiguration>(
  'wallpaperdb.factory.ExecutionConfiguration'
);
export const legacyExecutionSettings: ExecutionSettings = {
  model: 'gpt-6.1-sol',
  effort: null,
  mode: null,
  permissionLevel: null,
};
export interface Intent {
  readonly execution?: ExecutionSettings;
  readonly generation?: number;
  readonly receiptProtocol?: 'delivery-v1';
  readonly includeCodeFromIssues?: readonly number[];
  readonly selectionBase?: string;
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
  /** A journal-owned worker's lifecycle is known but its checkout is unverified.
   * Reporting only; never authorizes a stage or continuation. */
  | {
      readonly kind: 'unverified';
      readonly threadId: string;
      readonly status: string;
      /** Authenticated manual message boundary, reporting and receipt freshness only. */
      readonly manual?: { readonly runId: string };
      readonly run?: { readonly id: string; readonly ordinal: number; readonly startedAt?: number };
    }
  | {
      readonly kind: 'found';
      readonly observedExecution?: ObservedExecution;
      readonly threadId: string;
      readonly status: string;
      /** A fresh state must follow this maintainer-initiated run. Never rewinds a stage. */
      readonly manual?: { readonly runId: string };
      readonly answeredQuestions?: readonly string[];
      readonly run?: { readonly id: string; readonly ordinal: number; readonly startedAt?: number };
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
  /** Atomic revision compare-and-set. Commands and delivery claims share this journal.
   * With a stage, reserve that absent immutable stage and matching pending control
   * together. A stale revision, occupied stage or mismatching pending request rejects
   * both writes, so a superseded instruction cannot consume a reconciliation attempt. */
  saveControl(state: Control, stage?: StageRequest): Effect.Effect<boolean, Unavailable>;
  readWait(): Effect.Effect<WaitState | null, Unavailable>;
  /** Append atomically at revision; competing writers cannot overwrite a deadline or delivery identity. */
  saveWait(state: WaitState): Effect.Effect<boolean, Unavailable>;
  reserve(intent: Intent): Effect.Effect<boolean, Unavailable>;
  /** Run observations are keyed by exact provider ID and survive reopen. Repeating that
   * observation returns true; another provider turn has its own record. Records retain the
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
  /** Durable terminal delivery authority, recorded before releasing observation.
   * The execution snapshot is historical; no subscription is needed to retain landing. */
  readonly retirement?: {
    readonly publication: Pick<AcceptedPublication, 'url' | 'commit' | 'base'> & {
      readonly lifecycle?: string;
    };
    readonly execution: {
      readonly threadId: string;
      readonly status: string;
      readonly run?: { readonly id: string; readonly ordinal: number };
    };
    readonly stageIndex?: number;
  };
  /** Reporting ownership, independent of readiness. Retained across repair and restart. */
  readonly ownership?: { readonly threadId: string; readonly prUrl?: string };
  /** Terminal ownership fence, committed atomically with dependency-admission release. */
  readonly released?: boolean;
  readonly dependencyRecovery?: {
    readonly index: number;
    readonly run: { readonly id: string; readonly ordinal: number };
    readonly progress: string;
  };
  /** A verified unsuccessful implementation opens same-thread manual repair.
   * Successor associations are immutable stage records, never another launch. */
  readonly reconciliation?: {
    readonly attempts: number;
    readonly migrated: boolean;
    readonly pending?: StageRequest;
  };
  readonly manualRepair?: {
    readonly index: number;
    readonly threadId: string;
    readonly run: { readonly id: string; readonly ordinal: number };
    /** Durable continuation intent; recover the immutable stage before accepting a result. */
    readonly adoption?: StageRequest;
  };
  /** Current fresh implementation attempt. Prior immutable stages and worktrees remain retained. */
  readonly restart?: { readonly index: number };
  /** Last verified ready or landed association survives external retargeting and restart.
   * Revalidation still gates all prerequisite use and external maintenance. */
  readonly prerequisite?: AcceptedPublication;
  readonly revision: number;
  readonly cancelled: boolean;
  readonly claimed: readonly number[];
  readonly parked?: {
    readonly run?: { readonly id: string; readonly ordinal: number; readonly startedAt?: number };
    readonly index: number;
    readonly question: { readonly id: string; readonly text: string };
  };
}
export const JobStore = Context.Service<JobStore>('wallpaperdb.factory.JobStore');
export interface RecoveryStatus {
  readonly phase?:
    | 'resolving'
    | 'reviewing'
    | 'verifying'
    | 'publishing'
    | 'manual-recovery'
    | 'waiting-capacity'
    | 'awaiting-answer'
    | 'complete';
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
  /** Read-only existence, repository, self-reference and graph validation. */
  validateDependencies?(
    intent: Intent,
    dependencies: readonly string[]
  ): Effect.Effect<'valid' | 'invalid' | 'cycle', Unavailable>;
  /** Authoritative reread of edges, owning PR closure and open Planned issue. */
  verifyHandback?(
    intent: Intent,
    dependencies: readonly string[]
  ): Effect.Effect<boolean, Unavailable>;
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
  /** Prepare the exact included verified code, or legacy explicit prerequisites when absent.
   * Retain the selected default root through leased, writer-coordinated replay.
   * No child admission; inspect remains blocked until CI and metadata agree. */
  prepare?(
    issue: number,
    admitRecovery?: RecoveryAdmission,
    candidate?: {
      readonly includeCodeFromIssues: readonly number[];
      readonly selectionBase?: string;
    }
  ): Effect.Effect<void, Unavailable>;
  /** Observe the bound publication and retain known adverse observations locally.
   * External refs and PR metadata are read-only at this boundary. */
  pullRequest(intent: Intent): Effect.Effect<PullRequestObservation, Unavailable>;
  /** Read-only verification. An explicit inclusion list is authoritative for new work:
   * anchor it at the retained selectionBase or freshly fetched origin/main and return
   * that root for durable preparation. A supplied final base must pass current proof
   * and target checks. Without inclusions, retain legacy operator-pin semantics. */
  inspect(
    issue: number,
    candidate?: {
      readonly base?: string;
      readonly prBase?: string;
      readonly includeCodeFromIssues?: readonly number[];
      readonly selectionBase?: string;
    }
  ): Effect.Effect<
    {
      open: boolean;
      author: string;
      labels: readonly string[];
      /** Complete explicit blocking issue identities, including native and fallback edges. */
      blockers: readonly number[];
      prerequisite?: { readonly base: string; readonly prBase: string; readonly evidence: string };
      blockersReady: boolean;
      selectionBase?: string;
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
  /** True proves the owning run and its complete managed lineage have no active
   * execution, background work or registered waits, independently of receipts. */
  isIdle?: (threadId: string, runId: string | null) => Effect.Effect<boolean, Unavailable>;
  /** Verified landing permits observation release only after outstanding managed
   * responsibilities are idle. An adapter may retain supervision while evidence is unknown. */
  release?: (intent: Intent) => Effect.Effect<void, Unavailable>;
  /** Read-only preflight. Failure proves no launch was sent; run the returned effect only after claiming ownership. */
  prepareLaunch?(intent: Intent): Effect.Effect<ReturnType<Execution['launch']>, Unavailable>;
  /** Idempotent cancellation of this owning job, without cancelling unrelated threads. */
  interrupt(intent: Intent, threadId: string): Effect.Effect<void, Unavailable>;
  inspectStage(
    intent: Intent,
    request: StageRequest
  ): Effect.Effect<StageEvidence | null, Unavailable>;
  sendStage(intent: Intent, request: StageRequest): Effect.Effect<void, Unavailable>;
  /** Retain a confirmed owning thread when the provider returns it. */
  launch(
    intent: Intent
  ): Effect.Effect<{ kind: 'submitted'; threadId?: string } | { kind: 'uncertain' }, Unavailable>;
  /** A persisted owned replay stage may bind exact historical heads and repairs of its current commit. */
  observe(intent: Intent, repair?: StageRequest): Effect.Effect<Observation, Unavailable>;
}
export const Execution = Context.Service<Execution>('wallpaperdb.factory.Execution');
export interface Start {
  readonly execution?: ExecutionSettings;
  readonly generation?: number;
  readonly includeCodeFromIssues?: readonly number[];
  readonly selectionBase?: string;
  readonly issue: number;
  readonly prerequisiteEvidence?: string;
  readonly prBase?: string;
  readonly base: string;
  readonly context: string;
}
export type ResumeAction =
  | { index: number; questionId: string }
  | { index: number; runId: string; revision: number; resetReconciliation?: boolean };
export type Resume = ResumeAction & { jobId: string };
export interface RetryAction {
  readonly index: number;
  readonly attempt: number;
  readonly runId: string;
  readonly threadId: string;
  readonly revision: number;
  readonly base: string;
}
export type Retry = RetryAction & { readonly jobId: string };
export type Status =
  | { kind: 'empty' }
  | {
      kind: 'job';
      readonly controlRevision?: number;
      stageIndex?: number;
      publicationStartedAt?: number;
      reconciliation?: {
        readonly attempts: number;
        readonly limit: number;
        readonly migrated: boolean;
        readonly revision: number;
      };
      acknowledgement?: { stage: Stage; index: number; acceptedAt: number };
      /** Admission identity and original base remain stable; branch describes the current attempt. */
      intent: Intent;
      prerequisite?: AcceptedPublication;
      execution: Observation;
      elapsedMs: number;
      resume?: ResumeAction;
      retry?: RetryAction;
      delivery?: Delivery;
    };
export type StartResult = Status | { kind: 'occupied' } | { kind: 'rejected' };
export interface Job {
  retry(command: Retry): Effect.Effect<StartResult, Unavailable>;
  start(command: Start): Effect.Effect<StartResult, Unavailable>;
  status(): Effect.Effect<Status, Unavailable>;
  resume(command: Resume): Effect.Effect<StartResult, Unavailable>;
  cancel(jobId: string): Effect.Effect<StartResult, Unavailable>;
}
export const Job = Context.Service<Job>('wallpaperdb.factory.Job');

export type Stage = 'implementation' | 'review' | 'publication' | 'babysitting' | 'ci';
/** Immutable stage association, written before any delivery. Delivery identity survives continuation turns; observed ordinals can reject older results, never predict one exact completion run. */
export interface StageRequest {
  /** Retained publication responsibility transition time; absent for historical records. */
  readonly publicationStartedAt?: number;
  /** Authenticated main comparison retained after an agent rebase. */
  readonly acceptedBase?: string;
  readonly handback?: readonly string[];
  readonly reconciliation?: 'state' | 'migration';
  /** Exact verification gap retained with the durable recovery instruction. */
  readonly reconciliationReason?: ReconciliationReason;
  readonly receiptProtocol?: 'delivery-v1';
  /** Original verified recovery stage authorizing this manually started continuation. */
  readonly repairOrigin?: number;
  readonly comparison?: {
    readonly base: string;
    readonly prBase: string;
    readonly previousHead: string;
    readonly owningHeads?: readonly string[];
  };
  readonly index: number;
  /** Earliest successor ordinal, or actual observed ordinal for adopted/CI stages.
   * This retained ordering boundary is never an exact completion target. */
  readonly ordinal?: number;
  readonly continuation?: boolean;
  readonly resume?: boolean;
  readonly observedRunId?: string;
  /** Question already observed on this adopted run, retained atomically with its association. */
  readonly question?: { readonly id: string; readonly text: string };
  /** Logical delivery within this attempt; adopted continuations retain it. */
  readonly deliveryIndex?: number;
  readonly stage: Stage;
  readonly threadId: string;
  readonly commit: string;
  readonly previousRunId: string | null;
}
export type RequiredCheck = keyof Extract<AgentResponse, { kind: 'state' }>['checks'];
export type ReconciliationReason =
  | { readonly kind: 'checks-incomplete'; readonly checks: readonly RequiredCheck[] }
  | {
      readonly kind:
        | 'response-missing'
        | 'invalid-response'
        | 'receipt-mismatch'
        | 'instruction-unavailable'
        | 'review-unverified'
        | 'publication-unverified'
        | 'checkout-dirty'
        | 'head-mismatch'
        | 'comparison-unverified'
        | 'publication-mismatch';
    };
export interface StageEvidence {
  /** A current structured response exists, including malformed or negative state. */
  readonly responseObserved?: boolean;
  /** Actionable stage-verification outcome, not an execution failure or readiness grant. */
  readonly rejection?: ReconciliationReason;
  readonly base?: string;
  readonly unexpectedBase?: boolean;
  readonly idle?: boolean;
  /** True identifies an obsolete format; false proves a structurally supported
   * response after the instruction. Absence supplies neither proof. */
  readonly migrationRequired?: boolean;
  readonly dependencies?: readonly string[];
  readonly runId: string;
  readonly ordinal: number;
  readonly commit: string;
  /** A current completed state verified against instruction history, complete inactivity and clean Git. */
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
      /** Current provider mergeability for this exact PR head and target branch. Reporting only. */
      readonly mergeability?: 'clean' | 'conflicting' | 'pending' | 'unknown';
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
  /** Exact uncancelled control revision under which handback was verified.
   * Informational status rereads must never replace this release authority. */
  readonly handbackRevision?: number;
  readonly stage: Stage | 'ci';
  readonly progress?: string;
  readonly activity?:
    | 'dependency-handback'
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

/** Reporting is independent of execution authorization and receipt acceptance. */
export interface JobReporting {
  begin(): Effect.Effect<number, Unavailable>;
  failed(generation: number, intent: Intent, error: string): Effect.Effect<void, Unavailable>;
  observed(generation: number, status: Status): Effect.Effect<void, Unavailable>;
  accepted(
    intent: Intent,
    stage: Stage,
    index: number,
    commit?: string,
    publicationStartedAt?: number
  ): Effect.Effect<void, Unavailable>;
}
export const JobReporting = Context.Service<JobReporting>('wallpaperdb.factory.JobReporting');

/** Versioned agent state shared by stage completion and dependency handback. */
export type AgentResponse =
  | {
      readonly version: 1;
      readonly kind: 'state';
      readonly jobId: string;
      readonly checks: {
        readonly format: boolean;
        readonly lint: boolean;
        readonly tests: boolean;
        readonly crap: boolean;
        readonly coverage: boolean;
      };
      readonly base: string;
      readonly implemented: string;
      readonly checked: string;
      readonly reviewed?: string;
      readonly published?: string;
    }
  | {
      readonly version: 1;
      readonly kind: 'dependencies';
      readonly jobId: string;
      readonly requireUnimplementedIssues: readonly string[];
    };

export interface AgentReconciliationPolicy {
  readonly limit: number;
}
export const AgentReconciliationPolicy = Context.Service<AgentReconciliationPolicy>(
  'wallpaperdb.factory.AgentReconciliationPolicy'
);

export const defaultAgentReconciliationLimit = 3;
