import { Effect, type Tracer } from 'effect';
import type { Board } from '../../capabilities/board/index.js';
import type { Unavailable } from '../../capabilities/job/index.js';
import { requestOperation, type RequestHeaders } from '../tracing.js';
import { boardMeta, boardProblem } from './translation.js';
import type { V2Data } from './server.js';
/** The driving adapter executes effects. Composition owns the worker lifetime. */
export function liveV2Data(
  board: Board,
  run: <A>(operation: Effect.Effect<A, Unavailable>) => Promise<A>,
  pump: (id: string, parent?: Tracer.Span) => void,
  runSync: <A>(effect: Effect.Effect<A>) => A = Effect.runSync
): V2Data {
  const read = <A>(headers: RequestHeaders, name: string, work: () => A) =>
    runSync(requestOperation(headers, name, Effect.sync(work)));
  return {
    ...board,
    snapshot: (headers = {}) =>
      read(headers, 'factory.http.v2.snapshot', () => {
        const snapshot = board.snapshot();
        return { ...snapshot, apiVersion: 2 as const, meta: boardMeta(snapshot.meta) };
      }),
    subscribe: (listener, headers = {}) =>
      read(headers, 'factory.http.v2.subscribe', () => board.subscribe(listener)),
    changes: (after, headers = {}) =>
      read(headers, 'factory.http.v2.changes', () => {
        const result = board.changes(after);
        if ('_tag' in result) return boardProblem(result);
        return result.kind === 'changes'
          ? {
              ...result,
              batches: result.batches.map(({ meta, ...batch }) => ({
                ...batch,
                apiVersion: 2 as const,
                ...(meta ? { meta: boardMeta(meta) } : {}),
              })),
            }
          : result;
      }),
    details: (id, headers = {}) =>
      read(headers, 'factory.http.v2.details', () => {
        const details = board.details(id);
        return details ? { ...details, apiVersion: 2 as const } : undefined;
      }),
    search: (query, limit, token, headers = {}) =>
      read(headers, 'factory.http.v2.search', () => {
        const result = board.search(query, limit, token);
        return '_tag' in result ? boardProblem(result) : { ...result, apiVersion: 2 as const };
      }),
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
