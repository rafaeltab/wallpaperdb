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
  readonly capacity: { readonly concurrency: 1; readonly admission: 1 };
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
