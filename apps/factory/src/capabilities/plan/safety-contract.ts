import { Context, type Effect } from 'effect';
import type { Unavailable } from '../job/index.js';
import type { ScheduleState } from './contract.js';

export interface AutomaticDeadlineFailure {
  readonly attemptId: string;
  readonly code: 'model-deadline';
  readonly message: string;
  readonly attemptStartedAt: number;
  readonly modelHandedOffAt: number;
  readonly deadline: number;
  readonly failedAt: number;
  readonly attemptElapsedMs: number;
  readonly modelElapsedMs: number;
  readonly threadId: string | null;
  readonly runId: string | null;
}
export interface PlanningNotice {
  readonly id: string;
  readonly version: number;
  readonly createdAt: number;
  readonly acknowledgedAt: number | null;
  readonly failures: readonly AutomaticDeadlineFailure[];
}
export interface PlanningSafetyState {
  readonly version: number;
  readonly consecutiveModelDeadlineFailures: number;
  readonly currentNoticeId: string | null;
}
export interface PlanningSafetyView {
  readonly maximumAttempts: 3;
  readonly consecutiveModelDeadlineFailures: number;
  readonly pendingNoticeCount: number;
  readonly notice: PlanningNotice | null;
}
export const emptyPlanningSafety: PlanningSafetyView = {
  maximumAttempts: 3,
  consecutiveModelDeadlineFailures: 0,
  pendingNoticeCount: 0,
  notice: null,
};
export interface PlanningSafetySnapshot {
  readonly state: PlanningSafetyState;
  readonly schedule: ScheduleState;
  readonly currentNotice: PlanningNotice | null;
  readonly displayedNotice: PlanningNotice | null;
  readonly pendingNoticeCount: number;
  readonly failureRecorded: boolean;
}
/** One transaction compares both local revisions and commits the failure/notice,
 * counter and any automatic pause together. An already recorded attempt is a no-op.
 * Reads include at most the current and displayed notices, each with at most three rows.
 */
export interface PlanningSafetyStore {
  read(attemptId?: string): Effect.Effect<PlanningSafetySnapshot, Unavailable>;
  commit(change: {
    readonly expectedVersion: number;
    readonly expectedScheduleRevision: number;
    readonly state: PlanningSafetyState;
    readonly notice?: PlanningNotice;
    readonly expectedNoticeVersion?: number;
    readonly failure?: AutomaticDeadlineFailure;
    readonly schedule?: ScheduleState;
  }): Effect.Effect<'saved' | 'conflict' | 'duplicate', Unavailable>;
}
export const PlanningSafetyStore = Context.Service<PlanningSafetyStore>(
  'wallpaperdb.factory.PlanningSafetyStore'
);
export interface PlanningSafety {
  configure(
    command: Parameters<import('./contract.js').Scheduler['configure']>[0]
  ): Effect.Effect<'saved' | 'conflict' | 'rejected' | 'acknowledgement-required', Unavailable>;
  status(): Effect.Effect<{ schedule: ScheduleState; planning: PlanningSafetyView }, Unavailable>;
  mayLaunch(): Effect.Effect<boolean, Unavailable>;
  failed(failure: AutomaticDeadlineFailure): Effect.Effect<void, Unavailable>;
}
export const PlanningSafety = Context.Service<PlanningSafety>('wallpaperdb.factory.PlanningSafety');
