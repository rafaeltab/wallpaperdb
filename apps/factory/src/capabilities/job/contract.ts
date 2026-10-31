import { Context, type Effect, Schema } from 'effect';
export class Unavailable extends Schema.TaggedError<Unavailable>()('Unavailable', {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}
export interface Time {
  now(): Effect.Effect<number, Unavailable>;
}
export const Time = Context.Service<Time>('wallpaperdb.factory.Time');
export interface Intent {
  readonly id: string;
  readonly issue: number;
  readonly issueUrl: string;
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
      readonly worktree: string;
      readonly branch: string;
      readonly model: string;
    };
/** Atomic single-admission reservation; successful writes survive process/power loss.
 * Launch claims are durable and never automatically released, even after a crash.
 * This slice admits one job total. No implicit reset or retry of a launch. */
export interface JobStore {
  read(): Effect.Effect<Intent | null, Unavailable>;
  reserve(intent: Intent): Effect.Effect<boolean, Unavailable>;
  /** First run binding wins atomically and survives reopen. Repeating that
   * binding returns true; any replacement returns false. Records retain the
   * stage/thread/accepted commit and predecessor association for reconciliation. */
  bindRun(request: StageRequest, runId: string): Effect.Effect<boolean, Unavailable>;
  /** Stage records are immutable. saveStage returns false if already present;
   * callers must use the winning record. Claims permit at most one uncertain
   * send per stage and are never automatically released. */
  readStage(index: number): Effect.Effect<StageRequest | null, Unavailable>;
  saveStage(request: StageRequest): Effect.Effect<boolean, Unavailable>;
  claimStage(index: number): Effect.Effect<boolean, Unavailable>;
  claimLaunch(): Effect.Effect<boolean, Unavailable>;
}
export const JobStore = Context.Service<JobStore>('wallpaperdb.factory.JobStore');
export interface Issues {
  pullRequest(intent: Intent): Effect.Effect<PullRequestObservation, Unavailable>;
  inspect(issue: number): Effect.Effect<
    {
      open: boolean;
      author: string;
      labels: readonly string[];
      blockersReady: boolean;
      url: string;
    },
    Unavailable
  >;
}
export const Issues = Context.Service<Issues>('wallpaperdb.factory.Issues');
/** Launch may have succeeded on every failure. Observe must identify the exact title,
 * branch, model and isolated worktree; absence never authorizes a second launch. */
export interface Execution {
  inspectStage(
    intent: Intent,
    request: StageRequest
  ): Effect.Effect<StageEvidence | null, Unavailable>;
  sendStage(intent: Intent, request: StageRequest): Effect.Effect<void, Unavailable>;
  launch(intent: Intent): Effect.Effect<{ kind: 'submitted' | 'uncertain' }, Unavailable>;
  observe(intent: Intent): Effect.Effect<Observation, Unavailable>;
}
export const Execution = Context.Service<Execution>('wallpaperdb.factory.Execution');
export interface Start {
  readonly issue: number;
  readonly base: string;
  readonly context: string;
}
export type Status =
  | { kind: 'empty' }
  | { kind: 'job'; intent: Intent; execution: Observation; elapsedMs: number; delivery?: Delivery };
export type StartResult = Status | { kind: 'occupied' } | { kind: 'rejected' };
export interface Job {
  start(command: Start): Effect.Effect<StartResult, Unavailable>;
  status(): Effect.Effect<Status, Unavailable>;
}
export const Job = Context.Service<Job>('wallpaperdb.factory.Job');

export type Stage = 'implementation' | 'review' | 'publication';
/** Immutable stage association, written before any delivery. Index is also the
 * expected T3 run ordinal: unrequested intervening turns never count as acceptance. */
export interface StageRequest {
  readonly index: number;
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
  readonly linked?: readonly string[];
}
export type PullRequestObservation =
  | { readonly kind: 'absent' | 'ambiguous' }
  | {
      readonly kind: 'found';
      readonly url: string;
      readonly commit: string;
      readonly ready: boolean;
      readonly landed: boolean;
    };
export interface Delivery {
  readonly stage: Stage | 'ci';
  readonly commit: string;
  readonly ready: boolean;
  readonly landed: boolean;
  readonly pr?: PullRequestObservation;
}
