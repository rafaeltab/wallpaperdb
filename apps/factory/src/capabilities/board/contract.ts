import { Context, type Effect } from 'effect';
import type { Unavailable } from '../job/index.js';
import type { ScheduleSnapshot } from '../observe/index.js';
import type { PlanningAttempt } from '../plan/index.js';
import type { BoardCommand, CommandReceipt, BoardDelta, BoardSnapshot } from './model.js';
export interface BoardInput {
  schedule: ScheduleSnapshot;
  plan?: PlanningAttempt;
}
export interface BoardRecord {
  /** Recovery authority committed with the exact displayed failed attempts. */
  retryTargets?: Readonly<Record<string, RetryTarget>>;
  /** Private target committed atomically with the displayed notice, including CAS winners. */
  planningNoticeTarget?: CommandRecord['planningNotice'];
  snapshot: BoardSnapshot;
  inputVersion: string;
  details: Readonly<Record<string, import('./model.js').ItemDetails>>;
  history: readonly BoardDelta[];
}
export interface CommandRecord {
  retryTarget?: RetryTarget | null;
  planningNotice?: { readonly id: string; readonly version: number } | null;
  basis?: import('./model.js').PlanAttempt['basis'] | null;
  request: BoardCommand;
  receipt: CommandReceipt;
}
export interface RetryTarget {
  readonly retry: import('../job/index.js').Retry;
  readonly scheduleRevision: number;
}
/** A save publishes the board, private notice target and bounded replay atomically. Acceptance binds
 * UUID and full request durably before effects. Retry acceptance also atomically claims
 * its action/precondition; a distinct UUID cannot consume the same opportunity. Claims are never retried after restart:
 * an interrupted worker remains uncertain until operator reconciliation.
 */
export interface BoardStore {
  read(): Effect.Effect<BoardRecord | undefined, Unavailable>;
  save(record: BoardRecord, expectedCursor: string | null): Effect.Effect<boolean, Unavailable>;
  command(id: string): Effect.Effect<CommandRecord | undefined, Unavailable>;
  /** A technical failure can leave acceptance committed. Read the exact durable
   * request and receipt before claiming responsibility or dispatching effects. */
  accept(record: CommandRecord): Effect.Effect<boolean, Unavailable>;
  /** Claims only accepted responsibility. A technical failure can leave the claim
   * committed; inspect the durable receipt before retrying any external effect. */
  claim(record: CommandRecord): Effect.Effect<boolean, Unavailable>;
  /** Replay-safe persistence of an already computed outcome; never executes its command. */
  finish(record: CommandRecord): Effect.Effect<void, Unavailable>;
  interruptPending(reason: import('./model.js').Reason): Effect.Effect<void, Unavailable>;
  planBasis(
    id: string
  ): Effect.Effect<import('./model.js').PlanAttempt['basis'] | undefined, Unavailable>;
}
export const BoardStore = Context.Service<BoardStore>('wallpaperdb.factory.BoardStore');
export interface BoardCommands {
  execute(
    command: BoardCommand,
    target: import('./model.js').Action,
    input: ScheduleSnapshot,
    targets?: Pick<CommandRecord, 'planningNotice' | 'retryTarget'>
  ): Effect.Effect<
    {
      state: 'succeeded' | 'rejected' | 'uncertain';
      result: CommandReceipt['result'];
      reasons: readonly import('./model.js').Reason[];
    },
    Unavailable
  >;
}
export const BoardCommands = Context.Service<BoardCommands>('wallpaperdb.factory.BoardCommands');

export type BoardPlan = Omit<PlanningAttempt, 'deadline'> & {
  deadline: number | null;
  launch?: import('../plan/index.js').PlannerOwnership;
};
