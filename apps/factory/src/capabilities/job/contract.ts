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
  claimLaunch(): Effect.Effect<boolean, Unavailable>;
}
export const JobStore = Context.Service<JobStore>('wallpaperdb.factory.JobStore');
export interface Issues {
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
  | { kind: 'job'; intent: Intent; execution: Observation; elapsedMs: number };
export type StartResult = Status | { kind: 'occupied' } | { kind: 'rejected' };
export interface Job {
  start(command: Start): Effect.Effect<StartResult, Unavailable>;
  status(): Effect.Effect<Status, Unavailable>;
}
export const Job = Context.Service<Job>('wallpaperdb.factory.Job');
