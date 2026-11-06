import type { Effect } from 'effect';
import type { Board } from '../../capabilities/board/index.js';
import type { Unavailable } from '../../capabilities/job/index.js';
/** The driving adapter executes effects. Composition owns the worker lifetime. */
export function liveV2Data(
  board: Board,
  run: <A>(operation: Effect.Effect<A, Unavailable>) => Promise<A>,
  pump: () => void
) {
  return {
    ...board,
    plan: (id: string) => run(board.plan(id)),
    receipt: (id: string) => run(board.receipt(id)),
    submit: async (command: import('./contract.js').FactoryV2Command) => {
      const result = await run(board.submit(command));
      if (!('code' in result) && result.status === 202) pump();
      return result;
    },
  };
}
