import { Effect, type Tracer } from 'effect';
import type { Board } from '../../capabilities/board/index.js';
import type { Unavailable } from '../../capabilities/job/index.js';
import { requestOperation } from '../tracing.js';
/** The driving adapter executes effects. Composition owns the worker lifetime. */
export function liveV2Data(
  board: Board,
  run: <A>(operation: Effect.Effect<A, Unavailable>) => Promise<A>,
  pump: (id: string, parent?: Tracer.Span) => void
) {
  return {
    ...board,
    plan: (id: string, headers = {}) =>
      run(requestOperation(headers, 'factory.http.v2.plan', board.plan(id))),
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
      if (!('code' in result) && result.status === 202) pump(command.commandId, parent);
      return result;
    },
  };
}
