import { Effect, type Tracer } from 'effect';
import type { Board } from '../../capabilities/board/index.js';
import type { Unavailable } from '../../capabilities/job/index.js';
import { requestOperation } from '../tracing.js';
import { boardMeta, boardProblem } from './translation.js';
import type { V2Data } from './server.js';
/** The driving adapter executes effects. Composition owns the worker lifetime. */
export function liveV2Data(
  board: Board,
  run: <A>(operation: Effect.Effect<A, Unavailable>) => Promise<A>,
  pump: (id: string, parent?: Tracer.Span) => void
): V2Data {
  return {
    ...board,
    snapshot: () => {
      const snapshot = board.snapshot();
      return { ...snapshot, apiVersion: 2, meta: boardMeta(snapshot.meta) };
    },
    changes: (after) => {
      const result = board.changes(after);
      if ('_tag' in result) return boardProblem(result);
      return result.kind === 'changes'
        ? {
            ...result,
            batches: result.batches.map(({ meta, ...batch }) => ({
              ...batch,
              apiVersion: 2,
              ...(meta ? { meta: boardMeta(meta) } : {}),
            })),
          }
        : result;
    },
    details: (id) => {
      const details = board.details(id);
      return details ? { ...details, apiVersion: 2 } : undefined;
    },
    search: (query, limit, token) => {
      const result = board.search(query, limit, token);
      return '_tag' in result ? boardProblem(result) : { ...result, apiVersion: 2 };
    },
    plan: async (id: string, headers = {}) => {
      const details = await run(requestOperation(headers, 'factory.http.v2.plan', board.plan(id)));
      return details ? { ...details, apiVersion: 2 } : undefined;
    },
    receipt: (id: string, headers = {}) =>
      run(requestOperation(headers, 'factory.http.v2.receipt', board.receipt(id))),
    submit: async (command: import('./contract.js').FactoryV2Command, headers = {}) => {
      const { result, parent } = await run(
        requestOperation(
          headers,
          'factory.http.v2.submit',
          Effect.gen(function* () {
            const result = yield* board.submit(command);
            const parent = yield* Effect.currentSpan.pipe(
              Effect.catch(() => Effect.succeed(undefined))
            );
            return { result, parent };
          })
        )
      );
      if ('_tag' in result) return boardProblem(result);
      if (result.kind === 'accepted') pump(command.commandId, parent);
      return { status: result.kind === 'completed' ? 200 : 202, receipt: result.receipt };
    },
  };
}
