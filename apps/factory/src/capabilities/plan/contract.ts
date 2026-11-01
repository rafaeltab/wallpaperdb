import { Context, type Effect } from 'effect';
import type { Status, Unavailable } from '../job/index.js';
export interface PlanningIssue {
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
  readonly prerequisiteEvidence: string;
}
export interface PlanningInput {
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
  read(): Effect.Effect<PlanningInput, Unavailable>;
}
export const PlanningSource = Context.Service<PlanningSource>('wallpaperdb.factory.PlanningSource');
export interface Proposal {
  readonly selected: readonly {
    issue: number;
    reason: string;
    dependsOn: readonly number[];
    conflicts: readonly number[];
  }[];
  readonly deferred: readonly { issue: number; reason: string }[];
}
/** Preview only. No adapter may dispatch implementation work. */
export interface IPlanner {
  propose(input: PlanningInput): Effect.Effect<Proposal, Unavailable>;
}
export const IPlanner = Context.Service<IPlanner>('wallpaperdb.factory.IPlanner');
export interface Preview {
  readonly kind: 'preview' | 'stale';
  readonly selected: Proposal['selected'];
  readonly rejected: readonly { issue: number; reason: string }[];
  readonly input: PlanningInput;
}
export interface Plan {
  preview(): Effect.Effect<Preview, Unavailable>;
}
export const Plan = Context.Service<Plan>('wallpaperdb.factory.Plan');

export interface ResumeClaim {
  readonly issue: number;
  readonly index: number;
  readonly questionId: string;
  readonly run?: { readonly id: string; readonly ordinal: number };
}
export interface ScheduleState {
  readonly revision: number;
  readonly concurrency: number;
  readonly allowance: number;
  readonly paused: boolean;
  /** Durable active-slot claims for uncertain resumption, without another distinct admission. */
  readonly resuming?: readonly ResumeClaim[];
  /** Distinct reservations are permanent, including uncertain starts. */
  readonly admissions: readonly import('../job/index.js').Start[];
}
/** Atomic revision compare-and-set of controls and all admission reservations.
 * A successful save is durable before any job launch. */
export interface ScheduleStore {
  read(): Effect.Effect<ScheduleState, Unavailable>;
  save(state: ScheduleState): Effect.Effect<boolean, Unavailable>;
}
export const ScheduleStore = Context.Service<ScheduleStore>('wallpaperdb.factory.ScheduleStore');
/** Stable isolated lifecycle per issue, including after reopening the runtime. */
export interface JobPool {
  job(issue: number): Effect.Effect<import('../job/index.js').Job, Unavailable>;
}
export const JobPool = Context.Service<JobPool>('wallpaperdb.factory.JobPool');
export interface ScheduleStatus {
  readonly state: ScheduleState;
  readonly jobs: readonly Status[];
}
export interface Scheduler {
  status(): Effect.Effect<ScheduleStatus, Unavailable>;
  configure(command: {
    revision: number;
    concurrency: number;
    allowance: number;
    paused: boolean;
  }): Effect.Effect<'saved' | 'conflict' | 'rejected', Unavailable>;
  tick(base: string): Effect.Effect<ScheduleStatus, Unavailable>;
  start(
    command: import('../job/index.js').Start
  ): Effect.Effect<import('../job/index.js').StartResult, Unavailable>;
  resume(command: {
    jobId: string;
    index: number;
    questionId: string;
  }): Effect.Effect<import('../job/index.js').StartResult, Unavailable>;
  cancel(jobId: string): Effect.Effect<import('../job/index.js').StartResult, Unavailable>;
}
export const Scheduler = Context.Service<Scheduler>('wallpaperdb.factory.Scheduler');
