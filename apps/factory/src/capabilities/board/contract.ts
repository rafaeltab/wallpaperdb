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
  snapshot: BoardSnapshot;
  inputVersion: string;
  details: Readonly<Record<string, import('./model.js').ItemDetails>>;
  history: readonly BoardDelta[];
}
export interface CommandRecord {
  basis?: import('./model.js').PlanAttempt['basis'] | null;
  request: BoardCommand;
  receipt: CommandReceipt;
}
/** A save publishes one coherent board plus bounded replay atomically. Acceptance binds
 * UUID and full request durably before effects. Claims are never retried after restart:
 * an interrupted worker remains uncertain until operator reconciliation.
 */
export interface BoardStore {
  read(): Effect.Effect<BoardRecord | undefined, Unavailable>;
  save(record: BoardRecord, expectedCursor: string | null): Effect.Effect<boolean, Unavailable>;
  command(id: string): Effect.Effect<CommandRecord | undefined, Unavailable>;
  accept(record: CommandRecord): Effect.Effect<boolean, Unavailable>;
  claim(record: CommandRecord): Effect.Effect<boolean, Unavailable>;
  finish(record: CommandRecord): Effect.Effect<void, Unavailable>;
  commands(): Effect.Effect<readonly CommandRecord[], Unavailable>;
}
export const BoardStore = Context.Service<BoardStore>('wallpaperdb.factory.BoardStore');
export interface BoardCommands {
  execute(
    command: BoardCommand,
    target: import('./model.js').Action,
    input: ScheduleSnapshot
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

export type BoardPlan = PlanningAttempt & { launch?: import('../plan/index.js').PlannerOwnership };
